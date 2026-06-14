import os
import numpy as np

# Try importing rasterio for GeoTIFF support, fail gracefully to synthetic if not installed
try:
    import rasterio
    RASTERIO_AVAILABLE = True
except ImportError:
    RASTERIO_AVAILABLE = False

# Crater Metadata definitions
CRATER_METADATA = {
    "shackleton": {
        "name": "Shackleton Crater",
        "center_lat": -89.9,
        "center_lon": 0.0,
        "diameter_km": 21.0,
        "depth_m": 4200,
        "rim_elevation_m": 1500,
        "floor_elevation_m": -2700,
        "description": "Located at the south pole. The rim is illuminated by solar rays ~90% of the year, while the interior is a classic Permanently Shadowed Region (PSR)."
    },
    "cabeus": {
        "name": "Cabeus Crater",
        "center_lat": -84.9,
        "center_lon": 324.5,
        "diameter_km": 100.0,
        "depth_m": 4000,
        "rim_elevation_m": 1000,
        "floor_elevation_m": -3000,
        "description": "Site of the 2009 LCROSS impact experiment, which physically confirmed the presence of water ice inside its deep, cold traps."
    },
    "shoemaker": {
        "name": "Shoemaker Crater",
        "center_lat": -88.1,
        "center_lon": 44.9,
        "diameter_km": 51.0,
        "depth_m": 3000,
        "rim_elevation_m": 800,
        "floor_elevation_m": -2200,
        "description": "Named after planetary scientist Eugene Shoemaker. Highly shadowed interior showing significant epithermal neutron flux suppression."
    }
}

class LunarDataManager:
    def __init__(self, data_dir="craters"):
        self.data_dir = data_dir
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)

    def get_crater_list(self):
        """Returns metadata list of supported craters."""
        return [{"id": cid, **meta} for cid, meta in CRATER_METADATA.items()]

    def load_crater_data(self, crater_id, grid_size=120):
        """
        Loads crater dataset.
        Attempts to read real GeoTIFF files if they exist in craters/{crater_id}_dem.tif and craters/{crater_id}_cpr.tif.
        Falls back to a scientifically accurate synthetic crater generator.
        """
        crater_id = crater_id.lower()
        if crater_id not in CRATER_METADATA:
            raise ValueError(f"Crater ID {crater_id} not supported.")

        # Attempt to load real data if available
        dem_path = os.path.join(self.data_dir, f"{crater_id}_dem.tif")
        cpr_path = os.path.join(self.data_dir, f"{crater_id}_cpr.tif")

        if RASTERIO_AVAILABLE and os.path.exists(dem_path) and os.path.exists(cpr_path):
            try:
                return self._load_real_data(dem_path, cpr_path, grid_size)
            except Exception as e:
                print(f"Error reading GeoTIFFs, falling back to model: {e}")

        # Fallback to realistic mathematical crater generation
        return self._generate_synthetic_crater(crater_id, grid_size)

    def _load_real_data(self, dem_path, cpr_path, grid_size):
        """Loads and downsamples real GeoTIFF data to grid_size."""
        with rasterio.open(dem_path) as dem_src:
            dem_data = dem_src.read(1, out_shape=(grid_size, grid_size))
            # Fill nodata values
            dem_data = np.nan_to_num(dem_data, nan=0.0)
            
        with rasterio.open(cpr_path) as cpr_src:
            cpr_data = cpr_src.read(1, out_shape=(grid_size, grid_size))
            cpr_data = np.nan_to_num(cpr_data, nan=0.0)

        # Scale elements to standard metric coordinates
        # Real slope calculation using grid spacing
        dx, dy = np.gradient(dem_data)
        # Assuming typical 20m grid resolution
        resolution = 20.0
        slope = np.arctan(np.sqrt(dx**2 + dy**2) / resolution) * (180.0 / np.pi)

        # Estimate illumination based on elevation & slope relative to south polar sun angles
        # In a real pipeline this is ray-traced, here we use elevation as a proxy for shadows
        normalized_elevation = (dem_data - np.min(dem_data)) / (np.max(dem_data) - np.min(dem_data))
        illumination = np.clip(normalized_elevation * 1.2 - slope / 45.0, 0.0, 1.0)
        
        # Temperature modeling from solar exposure
        temperature = 40.0 + illumination * 180.0 # 40K in shadow, 220K in sun

        return {
            "elevation": dem_data.tolist(),
            "slope": slope.tolist(),
            "illumination": illumination.tolist(),
            "cpr": cpr_data.tolist(),
            "temperature": temperature.tolist()
        }

    def _generate_synthetic_crater(self, crater_id, grid_size):
        """
        Generates a highly realistic scientific crater profile using:
        1. Radial profile equations for crater bowls (parabolic + rim uplift).
        2. Fractional Brownian Motion (fBm) noise for realistic micro-roughness.
        3. Shadow simulations.
        4. CPR (Circular Polarization Ratio) physics modeling.
        """
        meta = CRATER_METADATA[crater_id]
        
        # Create coordinates
        x = np.linspace(-1, 1, grid_size)
        y = np.linspace(-1, 1, grid_size)
        X, Y = np.meshgrid(x, y)
        R = np.sqrt(X**2 + Y**2)

        # 1. Base Crater Shape (Radial Profile)
        # Parabolic bowl inside R < 0.6, uplifted rim around R = 0.6, tapering off for R > 0.6
        depth = meta["depth_m"]
        rim_elev = meta["rim_elevation_m"]
        floor_elev = meta["floor_elevation_m"]
        
        elevation = np.zeros_like(R)
        
        # Inside the bowl
        mask_bowl = R <= 0.6
        # Parabolic interpolation from floor to rim
        elevation[mask_bowl] = floor_elev + (depth) * (R[mask_bowl] / 0.6)**2
        
        # Uplifted rim and outer slopes
        mask_rim = R > 0.6
        elevation[mask_rim] = rim_elev * np.exp(-3.0 * (R[mask_rim] - 0.6))
        
        # 2. Add Fractional Brownian Motion (Fractal Terrain Noise) for realism
        np.random.seed(hash(crater_id) % 123456)
        noise = np.zeros_like(R)
        amplitude = 120.0
        frequency = 3.0
        for _ in range(4): # 4 Octaves of noise
            noise += amplitude * np.sin(frequency * X * np.pi + np.random.rand()) * np.cos(frequency * Y * np.pi + np.random.rand())
            amplitude *= 0.5
            frequency *= 2.0
            
        elevation += noise

        # 3. Calculate Slope (gradient in degrees)
        # Spacing is calculated based on diameter_km
        spacing = (meta["diameter_km"] * 1000.0) / grid_size
        dy, dx = np.gradient(elevation, spacing)
        slope = np.arctan(np.sqrt(dx**2 + dy**2)) * (180.0 / np.pi)

        # Add a collapsed-wall ridge corridor along the diagonal Y = X
        # This simulates a rideable slope corridor of 8-12 degrees for the rover
        corridor_mask = np.abs(Y - X) < 0.22
        slope[corridor_mask & (R > 0.1) & (R < 0.65)] = np.clip(
            slope[corridor_mask & (R > 0.1) & (R < 0.65)] * 0.22,
            3.5,
            12.0
        )

        # Add minor noise to slopes for visual complexity
        slope += np.random.normal(0, 1.0, slope.shape)
        slope = np.clip(slope, 0.0, 60.0)

        # 4. Model Illumination (Permanent Shadows in the bowl floor)
        # Rims block sunlight. Solar elevation at poles is very low (~1.5 degrees)
        # Bowl floor is permanently shadowed
        illumination = np.ones_like(R)
        
        # Center of bowl is dark
        shadow_mask = R < 0.45
        illumination[shadow_mask] = 0.0
        
        # Transition zone (crater walls)
        transition_mask = (R >= 0.45) & (R < 0.6)
        illumination[transition_mask] = (R[transition_mask] - 0.45) / 0.15
        
        # Add local shadows due to slope facing away from solar vector
        # Assuming sun is shining from positive X direction at low angle
        local_normal_x = -dx / np.sqrt(dx**2 + dy**2 + 1e-6)
        slope_shadow = np.clip(1.0 + local_normal_x * 0.8, 0.0, 1.0)
        illumination = np.clip(illumination * slope_shadow, 0.0, 1.0)
        
        # Ensure rims have high illumination (up to 95%)
        rim_pixels = (R >= 0.58) & (R <= 0.62)
        illumination[rim_pixels] = np.clip(illumination[rim_pixels] + 0.3, 0.0, 0.95)

        # 5. Temperature Profile (T_max based on illumination)
        # Inside PSR it is ~40 K. Illuminated rims get up to 220 K
        temperature = 40.0 + illumination * 180.0

        # 6. CPR (Circular Polarization Ratio) Modeling
        # Subsurface ice (high CPR inside PSR bowl floor)
        # Volcanic/Impact rocks (high CPR on steep walls/rims due to roughness)
        cpr = np.zeros_like(R)
        
        # Base soil has low CPR (~0.25)
        cpr += np.random.normal(0.25, 0.05, R.shape)
        
        # Rock roughness: proportional to slope, especially on steep walls
        rock_cpr = (slope / 45.0) * 0.9
        cpr += np.clip(rock_cpr, 0.0, 0.8)
        
        # Ice CBOE signal: localized high CPR inside the PSR (coldest zone)
        # Place 2-3 specific water ice deposits on the flat floor regions of the PSR
        for i, (cx, cy, r_size) in enumerate([(-0.15, 0.1, 0.08), (0.1, -0.15, 0.06), (0.05, 0.2, 0.05)]):
            dist_to_deposit = np.sqrt((X - cx)**2 + (Y - cy)**2)
            ice_mask = dist_to_deposit < r_size
            # Only stable if cold
            valid_ice = ice_mask & (temperature < 110.0)
            cpr[valid_ice] = np.random.normal(1.3 + (0.1 * i), 0.1, np.sum(valid_ice))

        cpr = np.clip(cpr, 0.0, 2.5)

        return {
            "elevation": elevation.tolist(),
            "slope": slope.tolist(),
            "illumination": illumination.tolist(),
            "cpr": cpr.tolist(),
            "temperature": temperature.tolist()
        }

if __name__ == "__main__":
    manager = LunarDataManager()
    data = manager.load_crater_data("shackleton", grid_size=50)
    print("Synthetic data generated successfully.")
    print("Elevation array size:", len(data["elevation"]))
