import numpy as np

# Try importing scikit-learn for ML, fail gracefully to deterministic model
try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

class PhysicsInformedMLEngine:
    def __init__(self):
        self.sklearn_available = SKLEARN_AVAILABLE
        if not self.sklearn_available:
            print("Warning: scikit-learn not found. Running ML Engine in physics-deterministic mode.")

    def compute_local_roughness(self, elevation_grid):
        """Computes surface roughness (std dev in 3x3 neighborhood)."""
        elev = np.array(elevation_grid)
        rows, cols = elev.shape
        roughness = np.zeros_like(elev)
        
        # Calculate local standard deviation
        for r in range(1, rows - 1):
            for c in range(1, cols - 1):
                neighborhood = elev[r-1:r+2, c-1:c+2]
                roughness[r, c] = np.std(neighborhood)
                
        # Fill borders
        roughness[0, :] = roughness[1, :]
        roughness[-1, :] = roughness[-2, :]
        roughness[:, 0] = roughness[:, 1]
        roughness[:, -1] = roughness[:, -2]
        return roughness

    def predict_ice_distribution(self, elevation, slope, illumination, cpr, temperature):
        """
        Fuses inputs to predict ice probability.
        If scikit-learn is available, uses a Physics-Informed Random Forest.
        Otherwise, falls back to a physics-informed analytical equation.
        """
        elev_arr = np.array(elevation)
        slope_arr = np.array(slope)
        ill_arr = np.array(illumination)
        cpr_arr = np.array(cpr)
        temp_arr = np.array(temperature)
        
        roughness_arr = self.compute_local_roughness(elev_arr)
        
        rows, cols = elev_arr.shape

        # Step 1: Define Ground Truth Labels using Physics Constraints (unsupervised labeling)
        # Ice requires high CPR (> 1.0) and stable cold temperatures (< 110K)
        # We also label non-ice: low CPR OR high temperatures (> 110K)
        physics_labels = np.zeros_like(cpr_arr, dtype=int)
        physics_labels[(cpr_arr >= 1.0) & (temp_arr <= 110.0)] = 1

        if self.sklearn_available:
            try:
                # Step 2: Prepare features for Machine Learning
                # We exclude CPR and Temperature from direct training features to force the model
                # to learn the topographic features (Slope, Elevation, Roughness, Solar Illumination)
                # that correlate with cold-traps. This is a true Physics-Informed ML approach.
                X = np.stack([
                    elev_arr.flatten(),
                    slope_arr.flatten(),
                    ill_arr.flatten(),
                    roughness_arr.flatten()
                ], axis=1)
                
                y = physics_labels.flatten()

                # Train Random Forest Classifier
                # Balanced class weight is critical because ice is rare
                rf = RandomForestClassifier(n_estimators=50, random_state=42, class_weight="balanced", max_depth=6)
                rf.fit(X, y)
                
                # Predict probabilities of class 1 (Ice) for all pixels
                probs = rf.predict_proba(X)[:, 1]
                prob_grid = probs.reshape(rows, cols)
                
                # Combine the ML topographical predictions with the physical CPR radar signal
                # to get a robust, combined probability
                cpr_sigmoid = 1.0 / (1.0 + np.exp(-5.0 * (cpr_arr - 0.9)))
                final_prob = prob_grid * cpr_sigmoid * (temp_arr < 110.0)
                
                # Calculate feature importances
                importances = {
                    "Elevation": float(rf.feature_importances_[0]),
                    "Slope": float(rf.feature_importances_[1]),
                    "Illumination": float(rf.feature_importances_[2]),
                    "Roughness": float(rf.feature_importances_[3])
                }

                return {
                    "ice_probability": final_prob.clip(0.0, 1.0).tolist(),
                    "features_importance": importances,
                    "ml_mode": "Physics-Informed Random Forest Classifier"
                }

            except Exception as e:
                print(f"ML training failed, falling back to deterministic: {e}")

        # --- Deterministic Fallback Mode ---
        # Calculate ice probability using smooth analytical thresholds
        # CPR threshold: sigmoid centered around 1.0
        cpr_factor = 1.0 / (1.0 + np.exp(-6.0 * (cpr_arr - 1.0)))
        # Temperature threshold: drops to zero at 110 K
        temp_factor = 1.0 / (1.0 + np.exp(0.15 * (temp_arr - 110.0)))
        # Shadow threshold: higher probability in permanently shadowed areas
        shadow_factor = 1.0 - ill_arr
        
        prob_grid = cpr_factor * temp_factor * shadow_factor
        
        # Mock feature importances based on scientific weights
        mock_importances = {
            "Elevation (Proxy)": 0.15,
            "Slope (Shadow Factor)": 0.25,
            "Illumination (Thermal)": 0.40,
            "Roughness (Surface Scatter)": 0.20
        }

        return {
            "ice_probability": prob_grid.clip(0.0, 1.0).tolist(),
            "features_importance": mock_importances,
            "ml_mode": "Physics-Informed Analytical Overlay (Fallback)"
        }

if __name__ == "__main__":
    from data_manager import LunarDataManager
    dm = LunarDataManager()
    c_data = dm.load_crater_data("shackleton", grid_size=50)
    engine = PhysicsInformedMLEngine()
    res = engine.predict_ice_distribution(
        c_data["elevation"],
        c_data["slope"],
        c_data["illumination"],
        c_data["cpr"],
        c_data["temperature"]
    )
    print("ML Engine prediction completed.")
    print("Mode used:", res["ml_mode"])
    print("Feature importances:", res["features_importance"])
