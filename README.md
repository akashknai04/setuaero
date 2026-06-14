# Lunar Ice Pathfinder
### Multi-Sensor Satellite Data Fusion, Physics-Informed ML, and Terramechanics-Aware Traverse Planner for Lunar South Pole Missions

---

## 1. Executive Summary & Scientific Gap
NASA's Artemis program and various robotic commercial landers target the Lunar South Pole due to the presence of Permanently Shadowed Regions (PSRs) in crater basins. These areas act as "cold traps" where volatile water ice is thermally stable at temperatures below $110\text{ K}$ ($-163^\circ\text{C}$). 

However, landing and pathfinding in these polar terrains present major challenges:
1. **The Radar ambiguity trap**: Both water ice and rocky ejecta fields produce high Circular Polarization Ratio (CPR) radar returns. Standard thresholding leads to false-positive ice classifications.
2. **The Landing Contradiction**: Landers require high solar illumination and flat slopes to survive. Craters containing water ice are dark, cold, and steep.
3. **Terramechanics**: Loose lunar regolith causes high slip ratios on slopes, risking rover entrapment.

**Lunar Ice Pathfinder** addresses this by fusing radar polarimetry, laser altimetry, and thermal data into a **Physics-Informed Machine Learning Engine** to accurately detect ice, select optimal sunlit landing spots, and plan safe, energy-budgeted rover routes.

---

## 2. Advanced Science & Mathematical Formulations

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

## 3. System Architecture & Data Flow

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

## 4. Setup & Running Locally

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

---

## 5. Deployment

### Web Deployment (Vercel)
The project includes a `vercel.json` file. To deploy:
1. Push your repository to GitHub.
2. Import the repository on **Vercel**.
3. In Environment Variables, add `VITE_API_URL` pointing to your deployed API server (e.g., hosted on Render or Railway).
4. Vercel will automatically compile the React frontend.
