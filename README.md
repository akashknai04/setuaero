# Lunar Ice Pathfinder

An interactive mission planning dashboard for the Lunar South Pole that identifies water ice deposits using Circular Polarization Ratio (CPR) and thermal stability, assesses landing site safety (slope & solar illumination), and plans optimal, energy-aware rover paths from sunlit rims into dark Permanently Shadowed Regions (PSRs).

---

## 🚀 How to Run the Project

This project contains a **FastAPI backend** (Python) and a **React + Plotly.js frontend** (Vite).

### Prerequisite Packages (Python)
Make sure you have the core packages installed:
```bash
pip install fastapi uvicorn numpy pydantic
# Optional (for full ML training and real GeoTIFF reading):
pip install scikit-learn rasterio
```

### Step 1: Start the Backend API
Run the following command from the project root:
```bash
python backend/app.py
```
The backend will start running on [http://localhost:8000](http://localhost:8000).

### Step 2: Start the Frontend App
Run the following commands from the project root:
```bash
npm install
npm run dev
```
The web dashboard will start running on [http://localhost:3000](http://localhost:3000). Open this URL in your web browser.

---

## 🔬 Scientific Details & Advanced Features

### 1. Decoupling Rocks vs. Ice (CPR & Thermal Fusion)
Both rough rocks and water ice yield a high Circular Polarization Ratio (CPR > 1.0) in radar scans.
* **Rough rocks** scatter radar signal and occur anywhere.
* **Subsurface water ice** exhibits the Coherent Backscatter Opposition Effect (CBOE) and can only exist where temperatures remain below **110 K (-163°C)**.
* Our **Physics-Informed ML Engine** uses a **Random Forest Classifier** trained on local terrain parameters (Elevation, Slope, Illumination, and Roughness) to distinguish between rocky hazards and true ice stability zones.

### 2. Energy-Aware A* Pathfinder
Standard pathfinders only check distance. This system routes a rover using:
* **Terramechanics Limit**: Any slope angle $> 15^\circ$ is treated as a hard obstacle to prevent rover slippage and tipping.
* **Uphill Power Draw**: Traverses uphill increase energy cost quadratically.
* **Solar Offset**: Travelling in sunlit areas charges the rover's batteries, reducing net power consumption.

### 3. Landing Site Selection (LSS)
Future landers cannot land in the dark PSRs (no solar power, frozen electronics). Our landing site scoring panel automatically ranks 3 pre-defined candidate sites on the crater rim according to safety criteria (Slope $< 12^\circ$, high solar illumination, proximity to PSR ice targets).

---

## 🛰️ How to Load Real NASA / ISRO GeoTIFF Data

The system is configured with a hybrid data loader. By default, it generates mathematically accurate 3D profiles of **Shackleton**, **Cabeus**, and **Shoemaker** craters. 

To use real satellite data:
1. Go to NASA's [LROC QuickMap](https://quickmap.lroc.asu.edu/).
2. Draw a box over your target crater near the South Pole.
3. Export the **LOLA DEM (Elevation)** and **Mini-RF/DFSAR (CPR)** layers as GeoTIFF files.
4. Save them in the `craters/` directory as:
   * `craters/shackleton_dem.tif` and `craters/shackleton_cpr.tif`
   * `craters/cabeus_dem.tif` and `craters/cabeus_cpr.tif`
   * `craters/shoemaker_dem.tif` and `craters/shoemaker_cpr.tif`
5. The backend will automatically detect the files and parse them using `rasterio`.
