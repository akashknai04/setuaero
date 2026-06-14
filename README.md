# Lunar Ice Pathfinder
### Multi-Sensor Satellite Data Fusion, Physics-Informed ML, and Terramechanics-Aware Rover Traverse Planner for Lunar South Pole Missions

---

## 1. Executive Summary & Scientific Gap
NASA's Artemis program and various robotic commercial landers target the Lunar South Pole due to the presence of Permanently Shadowed Regions (PSRs) in crater basins. These areas act as "cold traps" where volatile water ice is thermally stable at temperatures below $110\text{ K}$ ($-163^\circ\text{C}$). 

However, landing and pathfinding in these polar terrains present major challenges:
1. **The Radar ambiguity trap**: Both water ice and rocky ejecta fields produce high Circular Polarization Ratio (CPR) radar returns. Standard thresholding leads to false-positive ice classifications.
2. **The Landing Contradiction**: Landers require high solar illumination and flat slopes to survive. Craters containing water ice are dark, cold, and steep.
3. **Terramechanics**: Loose lunar regolith causes high slip ratios on slopes, risking rover entrapment.

**Lunar Ice Pathfinder** addresses this by fusing radar polarimetry, laser altimetry, and thermal data into a **Physics-Informed Machine Learning Engine** to accurately detect ice, select optimal sunlit landing spots, and plan safe, energy-budgeted rover routes.

---

## 🛠️ 2. Problems Faced & Engineering Solutions (The Engineering Journey)

During development, we faced critical data, ML, and systems engineering challenges. Below is how we resolved each of them:

### Challenge 1: Raw Polar Radar Data is Not ML-Ready
* **The Problem**: Raw Chandrayaan-2 DFSAR and LRO Mini-RF radar data are distributed in complex, multi-gigabyte PDS data records that require expert polarimetric processing. Downloading and parsing these global maps during a 24-48h hackathon is impossible and prone to API failures.
* **Our Solution**: We engineered a **Hybrid Data Ingestion Engine** (`data_manager.py`). It searches for real, locally cropped GeoTIFFs (e.g. 1-2MB patches of Shackleton Crater). If they are missing, it falls back to a **3D Crater Digital Twin generator** that mathematically models the crater using radial profile depth equations, 2D fractional Brownian motion (fractal noise) for micro-roughness, and slope shadow approximations. This ensures a fully functional, zero-dependency demo.

### Challenge 2: Black-Box Neural Networks Lack Credibility
* **The Problem**: Training a U-Net or CNN from scratch for "ice detection" in a hackathon is a red flag. There are no pixel-by-pixel ground truth labels for lunar ice, meaning any deep learning model would be learning to fit random noise.
* **Our Solution**: We implemented a **Physics-Informed Machine Learning (PIML)** approach (`ml_engine.py`). Instead of a black box, we use physical equations (fusing radar CPR and Diviner thermal stability thresholds) to automatically label pixels as "Ice Candidates" in the backend. We then train a **Random Forest Classifier** in real-time using *only* topographical features (Elevation, Slope, Illumination, and Roughness) as inputs. The AI learns the topographic correlation of cold traps, making it robust and scientifically defensible.

### Challenge 3: Rover Pathfinding was Disconnected from Terrain Safety
* **The Problem**: Running standard A* or Dijkstra on a generic 2D grid is a computer science homework assignment. It ignores the physical constraints of a lunar rover, such as tipping hazards and solar array charging.
* **Our Solution**: We built a **Terramechanics-Aware Pathfinder** (`pathfinder.py`). We set a hard slope limit of $15^\circ$ to prevent regolith wheel slippage and roll-overs. Our cost function calculates **uphill elevation work** and rewards the rover with **solar charging offsets** when traversing sunlit crater rims. The system also calculates cumulative battery drain inside the dark PSR and tracks whether the rover has the capacity to return to sunlight.

### Challenge 4: Port/Address Binding Conflicts in Local Run
* **The Problem**: During testing, the backend API returned `404 Not Found` for endpoints because port `8000` was occupied by a stray local loopback process, intercepting API traffic and breaking the React-FastAPI connection.
* **Our Solution**: We diagnosed the port conflict using network sockets mapping, terminated the stray process, and configured the backend to cleanly bind to port `8000`. We also refactored the frontend (`src/App.jsx`) to dynamically read the base API url using Vite environment variables (`import.meta.env.VITE_API_URL`), making it fully ready for production cloud deployments (like Vercel and Render).

---

## ⚙️ 3. Technology Stack Used

Our project operates on a lightweight, highly responsive full-stack architecture optimized for high-performance geospatial calculations and real-time visualization:

### Frontend (User Interface)
*   **Vite + React**: Client-side application framework ensuring sub-second UI updates and rendering.
*   **Plotly.js (`react-plotly.js`)**: 
    *   *3D Surface Plot*: Generates interactive 3D crater topography models, overlaying the rover's A* path along elevation contours.
    *   *2D heatmaps*: Displays slope hazard and ice distribution grids.
*   **TailwindCSS & Glassmorphism**: Provides a high-fidelity "Mission Control" visual aesthetic (glow borders, neon overlays, and scanline animations).
*   **jsPDF**: Generates PDF mission briefing reports locally in the browser.
*   **canvas-confetti**: Interactive animation triggering when the rover path solves successfully.

### Backend (Analytical API Engine)
*   **Python 3**: Core language used for pathfinding, ML training, and geospatial processing.
*   **FastAPI**: Asynchronous web server exposing endpoints with minimal latency and full CORS configuration.
*   **NumPy**: Executes matrix calculations and downsamples topographic grids.
*   **scikit-learn**: Core ML package used to train the Random Forest Classifier on the fly.
*   **rasterio**: Ingests real georeferenced GeoTIFF data products (LOLA elevation and S/L-band radar CPR maps).

---

## 🛰️ 4. Satellite Datasets Ingested

To maintain geological accuracy, the system is designed to load and parse georeferenced data products from active lunar spacecraft:

1. **NASA LRO LOLA DEM (Digital Elevation Model)**:
   * *Source*: Lunar Orbiter Laser Altimeter gridded data records (`pds-geosciences.wustl.edu`).
   * *Resolution*: Up to 5 meters/pixel in polar regions.
   * *Usage*: Ingests raw heights to compute surface slopes ($\theta$) and localized regolith roughness.
2. **LRO Mini-RF & Chandrayaan-1/2 DFSAR (Circular Polarization Ratio)**:
   * *Source*: Fully polarimetric synthetic aperture radar mosaics.
   * *Wavelength*: S-band (12.6 cm) and L-band (24 cm).
   * *Usage*: Provides Circular Polarization Ratio (CPR) signatures where values $> 1.0$ indicate potential subsurface ice crystalline scattering (CBOE).
3. **NASA LRO Diviner Lunar Radiometer**:
   * *Source*: Thermal mapping sensor data grids.
   * *Usage*: Provides peak surface temperatures. Water ice is only stable in regions with temperatures persistently below $110\text{ K}$ ($-163^\circ\text{C}$).

---

## 🤖 5. The AI / Machine Learning Engine (How It Works)

To bypass the complete lack of lunar ground-truth labels, the project implements a **Physics-Informed Machine Learning (PIML)** pipeline in [`backend/ml_engine.py`](file:///c:/Users/sweth/OneDrive/Desktop/asking%20knows/backend/ml_engine.py):

### The 4-Step ML Pipeline:
1. **Automated Physical Labeling ($y$)**: We generate the labels automatically using physical constraints:
   $$\text{Label} = 1 \quad \text{if} \quad \text{CPR} \ge 1.0 \;\text{ AND }\; \text{Temperature} \le 110\text{ K} \quad (\text{else } 0)$$
2. **Topographic Features ($X$)**: To force the classifier to learn the *topographic shape* of cold traps, we train the model using only terrain shape parameters: `Elevation`, `Local Slope`, `Solar Illumination (Shadows)`, and `Roughness` (local standard deviation of height). We exclude CPR and Temperature from features.
3. **Random Forest Classifier (`scikit-learn`)**: We train a Random Forest model on the fly in the backend (completes in $< 0.1\text{ seconds}$).
4. **Generalization & Feature Importance**: The model predicts a clean **Ice Probability Map** for the entire grid, smoothing out sensor noise. It also outputs feature importances, showing how heavily the model relied on parameters like slope or roughness.

---

## 6. Advanced Science & Mathematical Formulations

### A. Radar Backscatter & Ice Decoupling (CPR Physics)
The Circular Polarization Ratio (CPR) is the ratio of same-circular (SC) to opposite-circular (OC) backscattered power:
$$\text{CPR} = \frac{P_{\text{SC}}}{P_{\text{OC}}}$$
* **Rocks**: High surface roughness causes double-bounce reflection, generating high CPR both in sunlit and shadowed zones.
* **Ice**: Pure ice crystals cause the **Coherent Backscatter Opposition Effect (CBOE)**, returning high CPR. This signal is only physically stable in regions where temperature $T_{\text{max}} < 110\text{ K}$.

To isolate ice from rocks, the system fuses **LRO Mini-RF / Chandrayaan-2 DFSAR** radar data with **LRO Diviner** thermal data and **LOLA** illumination masks using a Bayesian probability model:
$$P(\text{Ice}) = \text{Sigmoid}(\text{CPR} - 1.0) \times P_{\text{Thermal}} \times (1 - \text{Illumination})$$
Where:
* $P_{\text{Thermal}} = \frac{1}{1 + e^{0.15 \cdot (T - 110)}}$ (drops to $0$ as temperature exceeds $110\text{ K}$).

### B. Landing Site Selection (LSS) Multi-Criteria Evaluation
Candidates on the crater rim are evaluated using a Weighted Linear Combination (WLC) model:
$$\text{Safety Score} = w_{\text{slope}} \cdot S_{\text{norm}} + w_{\text{illum}} \cdot I_{\text{norm}} + w_{\text{prox}} \cdot P_{\text{norm}}$$
Where:
* **Slope Score ($S_{\text{norm}}$)**: $S_{\text{norm}} = \max\left(0, \frac{15^\circ - \theta}{15^\circ}\right)$. If slope $\theta > 15^\circ$, the score is $0$ (hard obstacle).
* **Illumination ($I_{\text{norm}}$)**: Solar exposure percentage (rims receive up to 90% annual sun).
* **Ice Proximity ($P_{\text{norm}}$)**: Normalized distance to the nearest predicted PSR ice reserve (rovers have finite range).

### C. Terramechanics & Energy-Aware Pathfinder (A*)
The rover pathfinder operates on an 8-way grid connectivity. Rather than minimizing Euclidean distance, it minimizes cumulative **energy consumption ($E$)**:
$$\text{Transition Cost} (A \to B) = \text{Distance} \times \left( P_{\text{base}} + \Delta P_{\text{slope}} - P_{\text{solar}} \right)$$

* **Geotechnical Slip Limit**: Slopes $\theta > 15^\circ$ are treated as absolute barriers due to regolith shear failure.
* **Slope Power Modification ($\Delta P_{\text{slope}}$)**:
  $$\Delta P_{\text{slope}} = m \cdot g \cdot \sin(\theta) \cdot v$$
  Uphill climbs ($\theta > 0$) require quadratic power scaling; downhill descents allow regenerational/braking discounts.
* **Solar Recharge Benefit ($P_{\text{solar}}$)**:
  $$P_{\text{solar}} = \text{Solar Array Efficiency} \times \text{Illumination}_B$$
  Traversing illuminated cells recovers energy. Inside PSRs ($\text{Illumination} = 0$), the rover runs entirely on battery storage.

---

## 7. System Architecture & Data Flow

```
+---------------------------------------------------------------------------------+
|                                  USER DASHBOARD                                 |
|                         (React / CSS Glassmorphic Panels)                       |
+---------------------------------------------------------------------------------+
          |                                                               ^
          | [Crater Selection / Start & End Coordinates]                  | [JSON Payload]
          v                                                               |
+---------------------------------------------------------------------------------+
|                                 FASTAPI BACKEND                                 |
+---------------------------------------------------------------------------------+
          |                                                               ^
          v                                                               |
+-----------------------+     +------------------------+     +--------------------+
|     DATA ENGINE       |     |  PHYSICS-INFORMED ML   |     |    A* PATHFINDER   |
|   (data_manager.py)   | --> |    (ml_engine.py)      | --> |  (pathfinder.py)   |
|   Ingests GeoTIFFs    |     | Trains Random Forest   |     | Evaluates slopes   |
|   or runs fallback    |     | on topography to map   |     | & battery budgets  |
|   crater twin models  |     | true ice probabilities |     | to construct route |
+-----------------------+     +------------------------+     +--------------------+
```

### Directory Structure
```text
asking knows/
├── backend/
│   ├── app.py                # FastAPI Server & CORS configuration
│   ├── data_manager.py       # Georeferenced TIF handler & synthetic crater generator
│   ├── pathfinder.py         # Energy-aware A* routing engine
│   └── ml_engine.py          # Physics-Informed Random Forest Classifier
├── src/
│   ├── App.jsx               # React Mission Control UI & Plotly.js visualizers
│   ├── index.css             # Glassmorphism, animations, and sci-fi theme styling
│   └── main.jsx              # Vite entry point
├── package.json              # Project packages (Plotly, jsPDF, Lucide)
├── vercel.json               # SPA route redirects for Vercel deployment
├── vite.config.js            # Build server configuration
└── README.md                 # Project scientific documentation
```

---

## 8. Setup & Running Locally

### Prerequisites
Ensure you have **Python 3.10+** and **Node.js 18+** installed.

### Backend Startup (Port 8000)
1. Navigate to the project directory.
2. Install Python packages:
   ```bash
   pip install fastapi uvicorn numpy pydantic scikit-learn
   # Optional for georeferenced GeoTIFF parsing:
   pip install rasterio
   ```
3. Run the API:
   ```bash
   python backend/app.py
   ```

### Frontend Startup (Port 3000)
1. Install node dependencies:
   ```bash
   npm install
   ```
2. Start Vite:
   ```bash
   npm run dev
   ```
3. Open your browser to [http://localhost:3000](http://localhost:3000).
