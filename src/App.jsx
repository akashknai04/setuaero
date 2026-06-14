import React, { useState, useEffect, useRef } from 'react';
import { 
  Compass, 
  MapPin, 
  BatteryCharging, 
  AlertTriangle, 
  Sun, 
  CloudSnow, 
  Download, 
  TrendingUp, 
  Activity, 
  RotateCcw,
  BookOpen
} from 'lucide-react';
import Plot from 'react-plotly.js';
import { jsPDF } from 'jspdf';

// Fallback metadata if API fails or is loading
const CRATERS_META = [
  {
    id: "shackleton",
    name: "Shackleton Crater",
    center_lat: -89.9,
    center_lon: 0.0,
    diameter_km: 21.0,
    depth_m: 4200,
    description: "Located at the south pole. The rim is illuminated by solar rays ~90% of the year, while the interior is a classic Permanently Shadowed Region (PSR)."
  },
  {
    id: "cabeus",
    name: "Cabeus Crater",
    center_lat: -84.9,
    center_lon: 324.5,
    diameter_km: 100.0,
    depth_m: 4000,
    description: "Site of the 2009 LCROSS impact experiment, which physically confirmed the presence of water ice inside its deep, cold traps."
  },
  {
    id: "shoemaker",
    name: "Shoemaker Crater",
    center_lat: -88.1,
    center_lon: 44.9,
    diameter_km: 51.0,
    depth_m: 3000,
    description: "Named after planetary scientist Eugene Shoemaker. Highly shadowed interior showing significant epithermal neutron flux suppression."
  }
];

// Grid coordinates for landing candidates (pre-scaled to 120x120 grid)
const CANDIDATE_SITES = {
  shackleton: [
    { name: "Alpha (Rim Edge)", r: 35, c: 42, type: "Rim", desc: "Optimal solar exposure, gentle slope" },
    { name: "Beta (Ridge Crest)", r: 85, c: 78, type: "Ridge", desc: "Good line-of-sight communication" },
    { name: "Gamma (Basin Slope)", r: 52, c: 54, type: "Basin", desc: "Scientific priority but high hazard" }
  ],
  cabeus: [
    { name: "Alpha (North Rim)", r: 30, c: 35, type: "Rim", desc: "Safe landing corridor, sunlit peaks" },
    { name: "Beta (Ejecta Blanket)", r: 75, c: 80, type: "Plains", desc: "Flat topography, long-range drive" },
    { name: "Gamma (Impact Floor)", r: 58, c: 56, type: "Basin", desc: "Direct LCROSS site access, zero light" }
  ],
  shoemaker: [
    { name: "Alpha (East Rim)", r: 40, c: 38, type: "Rim", desc: "Highly illuminated plateau" },
    { name: "Beta (Western Peak)", r: 80, c: 82, type: "Peak", desc: "Steep approach but high science return" },
    { name: "Gamma (Cold Trap)", r: 62, c: 60, type: "Basin", desc: "Deep PSR floor, permanently dark" }
  ]
};

export default function App() {
  const [craters, setCraters] = useState(CRATERS_META);
  const [selectedCrater, setSelectedCrater] = useState("shackleton");
  const [activeTab, setActiveTab] = useState("3d"); // 3d, cpr, hazard
  
  // Weights for Landing Site Scorer
  const [wSlope, setWSlope] = useState(0.40);
  const [wIllum, setWIllum] = useState(0.30);
  const [wProx, setWProx] = useState(0.30);

  // Data loaded from Backend API
  const [terrainData, setTerrainData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selected Points for Navigation
  const [startPoint, setStartPoint] = useState(null); // [row, col] - Lander
  const [endPoint, setEndPoint] = useState(null);     // [row, col] - Rover Target
  const [selectionMode, setSelectionMode] = useState("start"); // "start" or "end"

  // Route planned results
  const [routePath, setRoutePath] = useState([]);
  const [routeMetrics, setRouteMetrics] = useState(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planError, setPlanError] = useState(null);

  // Load craters and first terrain data on mount
  useEffect(() => {
    fetchCraters();
  }, []);

  useEffect(() => {
    fetchTerrain(selectedCrater);
    // Reset path when crater changes
    setStartPoint(null);
    setEndPoint(null);
    setRoutePath([]);
    setRouteMetrics(null);
    setPlanError(null);
  }, [selectedCrater]);

  const fetchCraters = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/craters');
      if (response.ok) {
        const data = await response.json();
        setCraters(data);
      }
    } catch (err) {
      console.warn("Could not fetch craters list, using default metadata", err);
    }
  };

  const fetchTerrain = async (craterId) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`http://localhost:8000/api/terrain/${craterId}?grid_size=120`);
      if (!response.ok) {
        throw new Error(`Failed to fetch terrain: ${response.statusText}`);
      }
      const data = await response.json();
      setTerrainData(data);
    } catch (err) {
      setError(err.message || "Failed to connect to backend server.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectLandingCandidate = (site) => {
    setStartPoint([site.r, site.c]);
    setSelectionMode("end"); // Autofocus to choosing target ice next
  };

  const handleMapClick = (event) => {
    // Check if points clicked on Plotly
    if (!event.points || event.points.length === 0) return;
    
    // Get row and col indices
    const point = event.points[0];
    const r = Math.round(point.y !== undefined ? point.y : point.pointIndex[0]);
    const c = Math.round(point.x !== undefined ? point.x : point.pointIndex[1]);
    
    if (r === undefined || c === undefined || isNaN(r) || isNaN(c)) return;

    if (selectionMode === "start") {
      setStartPoint([r, c]);
      setRoutePath([]);
      setRouteMetrics(null);
      setSelectionMode("end");
    } else {
      setEndPoint([r, c]);
      setRoutePath([]);
      setRouteMetrics(null);
    }
  };

  const runPathfinder = async () => {
    if (!startPoint || !endPoint) return;
    setIsPlanning(true);
    setPlanError(null);
    setRoutePath([]);
    setRouteMetrics(null);

    try {
      const response = await fetch('http://localhost:8000/api/plan-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          crater_id: selectedCrater,
          start: startPoint,
          end: endPoint,
          grid_size: 120
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Routing calculations failed.");
      }

      setRoutePath(data.path);
      setRouteMetrics(data.metrics);
      
      // Trigger canvas-confetti on success to wow judges
      import('canvas-confetti').then((confetti) => {
        confetti.default({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#bd00ff', '#ffffff']
        });
      });
    } catch (err) {
      setPlanError(err.message);
    } finally {
      setIsPlanning(false);
    }
  };

  const resetRouting = () => {
    setStartPoint(null);
    setEndPoint(null);
    setRoutePath([]);
    setRouteMetrics(null);
    setPlanError(null);
    setSelectionMode("start");
  };

  // Score candidate landing sites using the loaded terrain data
  const scoreCandidateSites = () => {
    if (!terrainData) return [];
    const sites = CANDIDATE_SITES[selectedCrater] || [];
    
    return sites.map(site => {
      const r = site.r;
      const c = site.c;
      
      const slope = terrainData.slope[r][c];
      const illum = terrainData.illumination[r][c];
      
      // Calculate ice proximity: find distance to nearest cell with high ice probability (>0.5)
      let minDistance = 9999.0;
      const size = 120;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          if (terrainData.ice_probability[i][j] > 0.5) {
            const dist = Math.sqrt((r - i)**2 + (c - j)**2);
            if (dist < minDistance) minDistance = dist;
          }
        }
      }
      
      // Normalize values between 0 and 1
      const slopeScore = Math.max(0, 15.0 - slope) / 15.0; // Slope > 15 gets 0
      const illumScore = illum;
      const proxScore = Math.max(0, 80.0 - minDistance) / 80.0; // Scaled proximity score

      // Weighted combination
      let scoreVal = 0;
      if (slope <= 15.0) {
        scoreVal = (wSlope * slopeScore + wIllum * illumScore + wProx * proxScore) * 100;
      }
      
      // Classify status
      let status = "GO";
      if (slope > 15.0) status = "NO-GO";
      else if (slope > 10.0 || illum < 0.2) status = "CAUTION";

      return {
        ...site,
        slope: slope.toFixed(1),
        illumination: (illum * 100).toFixed(0),
        dist_to_ice: minDistance === 9999.0 ? "N/A" : `${(minDistance * 0.15).toFixed(1)} km`,
        score: scoreVal.toFixed(0),
        status
      };
    }).sort((a, b) => b.score - a.score);
  };

  const exportPDF = () => {
    if (!terrainData) return;
    
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const meta = craters.find(c => c.id === selectedCrater) || CRATERS_META[0];
    const scoredSites = scoreCandidateSites();

    // Dark Mode Theme Background
    doc.setFillColor(11, 14, 27);
    doc.rect(0, 0, 210, 297, 'F');

    // Draw header glowing border
    doc.setDrawColor(0, 240, 255);
    doc.setLineWidth(0.8);
    doc.line(15, 25, 195, 25);

    // Title
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(0, 240, 255);
    doc.text("LUNAR ICE PATHFINDER - MISSION REPORT", 15, 20);

    // Section 1: Crater Geological Summary
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text("1. LUNAR REGION ANALYSIS SUMMARY", 15, 35);
    
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(180, 190, 210);
    doc.text(`Target Crater:  ${meta.name}`, 15, 43);
    doc.text(`Center Coordinates:  ${meta.center_lat}° S, ${meta.center_lon}° E`, 15, 49);
    doc.text(`Diameter:  ${meta.diameter_km} km   |   Depth:  ${meta.depth_m} m`, 15, 55);
    
    // Description text wrap
    const descLines = doc.splitTextToSize(meta.description, 180);
    doc.text(descLines, 15, 61);

    // Dynamic divider
    doc.setDrawColor(189, 0, 255);
    doc.setLineWidth(0.3);
    doc.line(15, 75, 195, 75);

    // Section 2: Landing Site Evaluation
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0, 240, 255);
    doc.text("2. MULTI-CRITERIA LANDING SITE ANALYSIS", 15, 83);
    
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(200, 210, 230);
    
    let y = 92;
    doc.text("Site Identifier", 15, y);
    doc.text("Slope", 65, y);
    doc.text("Sunlight", 85, y);
    doc.text("Ice Proximity", 110, y);
    doc.text("Safety Score", 145, y);
    doc.text("Status", 175, y);
    
    doc.setDrawColor(40, 50, 75);
    doc.line(15, y + 2, 195, y + 2);
    
    y += 8;
    scoredSites.forEach(s => {
      doc.text(s.name, 15, y);
      doc.text(`${s.slope}°`, 65, y);
      doc.text(`${s.illumination}%`, 85, y);
      doc.text(s.dist_to_ice, 110, y);
      doc.text(`${s.score} / 100`, 145, y);
      
      // Color code status text
      if (s.status === "GO") doc.setTextColor(16, 185, 129);
      else if (s.status === "CAUTION") doc.setTextColor(245, 158, 11);
      else doc.setTextColor(239, 68, 68);
      doc.text(s.status, 175, y);
      doc.setTextColor(200, 210, 230); // reset
      
      y += 6;
    });

    // Divider
    doc.setDrawColor(189, 0, 255);
    doc.line(15, 120, 195, 120);

    // Section 3: Planned Rover Telemetry
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0, 240, 255);
    doc.text("3. ROVER PATH PLANNING TELEMETRY", 15, 128);

    if (routeMetrics) {
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(180, 190, 210);

      doc.text(`Departure coordinates (Lander):  [Row: ${startPoint[0]}, Col: ${startPoint[1]}]`, 15, 136);
      doc.text(`Destination coordinates (Ice Deposit):  [Row: ${endPoint[0]}, Col: ${endPoint[1]}]`, 15, 142);
      
      doc.text(`Traverse Path Distance:`, 15, 152);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(`${routeMetrics.distance_km} km`, 65, 152);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(180, 190, 210);
      doc.text(`Maximum Slope Obstacle:`, 15, 158);
      doc.setFont("Helvetica", "bold");
      doc.text(`${routeMetrics.max_slope}°`, 65, 158);
      
      doc.setFont("Helvetica", "normal");
      doc.text(`Average Path Slope:`, 15, 164);
      doc.setFont("Helvetica", "bold");
      doc.text(`${routeMetrics.average_slope}°`, 65, 164);

      doc.setFont("Helvetica", "normal");
      doc.text(`Elevation Delta:`, 15, 170);
      doc.setFont("Helvetica", "bold");
      doc.text(`Climb: +${routeMetrics.total_climb_m}m  |  Descent: -${routeMetrics.total_descent_m}m`, 65, 170);

      doc.setFont("Helvetica", "normal");
      doc.text(`Final Rover Battery Health:`, 15, 178);
      doc.setFont("Helvetica", "bold");
      if (routeMetrics.final_battery_pct > 50) doc.setTextColor(16, 185, 129);
      else if (routeMetrics.final_battery_pct > 20) doc.setTextColor(245, 158, 11);
      else doc.setTextColor(239, 68, 68);
      doc.text(`${routeMetrics.final_battery_pct}%`, 65, 178);

      doc.setFont("Helvetica", "normal");
      doc.setTextColor(180, 190, 210);
      doc.text(`Exposure to PSR (Darkness):`, 15, 184);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(`${routeMetrics.shadow_traverse_pct}% of path`, 65, 184);

      doc.setFont("Helvetica", "normal");
      doc.setTextColor(180, 190, 210);
      doc.text(`ML Detection Mode:`, 15, 192);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(189, 0, 255);
      doc.text(terrainData.ml_mode, 65, 192);
    } else {
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(239, 68, 68);
      doc.text("No active path has been calculated for this mission briefing.", 15, 138);
    }

    // Footer signature
    doc.setDrawColor(0, 240, 255);
    doc.setLineWidth(0.3);
    doc.line(15, 270, 195, 270);
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100, 115, 140);
    doc.text("Lunar Ice Pathfinder System v1.0.0 — Powered by NASA LRO PDS Datasets", 15, 275);
    
    // Save PDF
    doc.save(`Lunar_Ice_Briefing_${selectedCrater.toUpperCase()}_Mission.pdf`);
  };

  const getScoredSites = scoreCandidateSites();
  const currentCraterMeta = craters.find(c => c.id === selectedCrater) || CRATERS_META[0];

  // Helper to compile data arrays for 3D/2D Plots
  const get3DPlotData = () => {
    if (!terrainData) return [];
    
    // elevation surface
    const plotData = [
      {
        z: terrainData.elevation,
        type: 'surface',
        colorscale: 'Blues',
        showscale: false,
        name: 'Terrain',
        hoverinfo: 'z+text',
        text: terrainData.slope.map(row => row.map(s => `Slope: ${s.toFixed(1)}°`))
      }
    ];

    // Overlay path in 3D
    if (routePath.length > 0) {
      const px = routePath.map(p => p[1]);
      const py = routePath.map(p => p[0]);
      // Grab elevation at path point + slight offset so line sits on top of terrain
      const pz = routePath.map(p => terrainData.elevation[p[0]][p[1]] + 80);

      plotData.push({
        x: px,
        y: py,
        z: pz,
        type: 'scatter3d',
        mode: 'lines+markers',
        line: { color: '#bd00ff', width: 8 },
        marker: { color: '#bd00ff', size: 4 },
        name: 'Rover Path'
      });
    }

    // Overlay Start point (Lander) in 3D
    if (startPoint) {
      plotData.push({
        x: [startPoint[1]],
        y: [startPoint[0]],
        z: [terrainData.elevation[startPoint[0]][startPoint[1]] + 150],
        type: 'scatter3d',
        mode: 'markers',
        marker: { color: '#10b981', size: 10, symbol: 'diamond' },
        name: 'Lander'
      });
    }

    // Overlay End point (Rover Target) in 3D
    if (endPoint) {
      plotData.push({
        x: [endPoint[1]],
        y: [endPoint[0]],
        z: [terrainData.elevation[endPoint[0]][endPoint[1]] + 150],
        type: 'scatter3d',
        mode: 'markers',
        marker: { color: '#00f0ff', size: 10, symbol: 'circle' },
        name: 'Ice Reserve'
      });
    }

    return plotData;
  };

  const getHeatmapData = (mode) => {
    if (!terrainData) return [];
    
    let zData = [];
    let colorscale = 'Reds';
    let hovername = '';

    if (mode === 'cpr') {
      zData = terrainData.ice_probability;
      colorscale = [
        [0.0, 'rgba(3, 3, 10, 0.95)'],
        [0.1, 'rgba(0, 50, 100, 0.4)'],
        [0.5, '#00f0ff'],
        [1.0, '#bd00ff']
      ];
      hovername = 'Ice Prob';
    } else {
      zData = terrainData.slope;
      colorscale = [
        [0.0, '#021a11'],
        [0.2, '#10b981'],
        [0.6, '#f59e0b'],
        [0.8, '#ef4444'],
        [1.0, '#ff3344']
      ];
      hovername = 'Slope';
    }

    const traces = [
      {
        z: zData,
        type: 'heatmap',
        colorscale: colorscale,
        showscale: true,
        hoverongaps: false,
        name: hovername,
        colorbar: {
          title: mode === 'cpr' ? 'Ice Prob' : 'Slope °',
          titlefont: { color: '#94a3b8' },
          tickfont: { color: '#94a3b8' }
        }
      }
    ];

    // Start Marker on 2D Heatmap
    if (startPoint) {
      traces.push({
        x: [startPoint[1]],
        y: [startPoint[0]],
        type: 'scatter',
        mode: 'markers+text',
        text: ['Lander'],
        textposition: 'top center',
        textfont: { color: '#10b981', size: 12 },
        marker: { color: '#10b981', size: 12, symbol: 'diamond', line: { color: '#fff', width: 2 } },
        name: 'Lander Start'
      });
    }

    // End Marker on 2D Heatmap
    if (endPoint) {
      traces.push({
        x: [endPoint[1]],
        y: [endPoint[0]],
        type: 'scatter',
        mode: 'markers+text',
        text: ['Ice Target'],
        textposition: 'top center',
        textfont: { color: '#00f0ff', size: 12 },
        marker: { color: '#00f0ff', size: 12, symbol: 'circle', line: { color: '#fff', width: 2 } },
        name: 'Rover Target'
      });
    }

    // Rover Route Path overlay in 2D Heatmap
    if (routePath.length > 0) {
      traces.push({
        x: routePath.map(p => p[1]),
        y: routePath.map(p => p[0]),
        type: 'scatter',
        mode: 'lines',
        line: { color: '#bd00ff', width: 3 },
        name: 'Rover Path'
      });
    }

    return traces;
  };

  return (
    <div className="flex flex-col min-h-screen text-slate-200">
      
      {/* 🚀 Header */}
      <header className="border-b border-cyan-500/10 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20 text-cyan-400">
            <Compass className="w-6 h-6 animate-spin-slow" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white header-glow flex items-center gap-2">
              LUNAR ICE PATHFINDER <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/20">V1.0.0</span>
            </h1>
            <p className="text-xs text-slate-400">Artemis Mission Planning Command Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs">
            <span className="pulse-dot"></span>
            <span className="text-slate-400 font-mono">MISSION CTRL:</span>
            <span className="text-green-400 font-bold uppercase tracking-wider">Online</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-mono">TARGET REGION:</label>
            <select 
              value={selectedCrater}
              onChange={(e) => setSelectedCrater(e.target.value)}
              className="bg-slate-900 text-sm font-semibold text-white px-3 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              {craters.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={exportPDF}
            disabled={isLoading}
            className="btn-sci-fi btn-cyan"
            title="Download full PDF Briefing"
          >
            <Download className="w-4 h-4" />
            <span>Export Briefing</span>
          </button>
        </div>
      </header>

      {/* 📖 Information bar */}
      <section className="bg-cyan-950/25 border-b border-cyan-500/10 px-6 py-3 flex items-start gap-3 text-sm text-cyan-200">
        <BookOpen className="w-4 h-4 mt-0.5 text-cyan-400 flex-shrink-0" />
        <div>
          <span className="font-semibold text-cyan-400">{currentCraterMeta.name}:</span>
          <span className="ml-1 text-slate-300">{currentCraterMeta.description}</span>
          <span className="ml-2 font-mono text-xs text-cyan-500">Center: {currentCraterMeta.center_lat}° S, {currentCraterMeta.center_lon}° E | Diameter: {currentCraterMeta.diameter_km} km</span>
        </div>
      </section>

      {/* ⚠️ Main Dashboard Workspace */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-950/20">
          <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
          <p className="text-sm font-mono text-cyan-400 tracking-wider">CALCULATING DIGITAL TWIN RADAR & TERRAIN MATRICES...</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center max-w-md mx-auto">
          <AlertTriangle className="w-16 h-16 text-red-500 animate-bounce" />
          <h2 className="text-lg font-bold text-white">Data Connection Failed</h2>
          <p className="text-sm text-slate-400">{error}</p>
          <div className="p-3 bg-red-950/20 border border-red-500/20 text-xs rounded text-red-300 font-mono">
            Ensure your FastAPI backend is running on port 8000 by executing: <br />
            <code>python backend/app.py</code>
          </div>
          <button 
            onClick={() => fetchTerrain(selectedCrater)}
            className="btn-sci-fi btn-cyan mt-2"
          >
            <RotateCcw className="w-4 h-4" />
            Retry Connection
          </button>
        </div>
      ) : (
        <div className="dashboard-grid flex-1">

          {/* 🔍 Left Sidebar: Landing Site Evaluation */}
          <aside className="glass-panel gap-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4" />
                Landing Site Evaluator
              </h2>
              <p className="text-xs text-slate-400">Multi-criteria ranking weighted in real-time.</p>
            </div>

            {/* Weights Sliders */}
            <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-900 flex flex-col gap-3">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-400">Slope Safety:</span>
                  <span className="text-white">{(wSlope * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={wSlope * 100}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) / 100;
                    setWSlope(val);
                    // Rebalance remaining weight
                    const rem = 1.0 - val;
                    setWIllum(rem * (wIllum / (wIllum + wProx || 1)));
                    setWProx(rem * (wProx / (wIllum + wProx || 1)));
                  }}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-400">Solar Illumination:</span>
                  <span className="text-white">{(wIllum * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={wIllum * 100}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) / 100;
                    setWIllum(val);
                    const rem = 1.0 - val;
                    setWSlope(rem * (wSlope / (wSlope + wProx || 1)));
                    setWProx(rem * (wProx / (wSlope + wProx || 1)));
                  }}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-400">Ice Proximity:</span>
                  <span className="text-white">{(wProx * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={wProx * 100}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) / 100;
                    setWProx(val);
                    const rem = 1.0 - val;
                    setWSlope(rem * (wSlope / (wSlope + wIllum || 1)));
                    setWIllum(rem * (wIllum / (wSlope + wIllum || 1)));
                  }}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>
            </div>

            {/* Candidate Rankings */}
            <div className="flex-1 overflow-y-auto min-h-[220px]">
              <table className="cyber-table">
                <thead>
                  <tr>
                    <th>Site Candidate</th>
                    <th>Safety Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {getScoredSites.map((site, index) => (
                    <tr 
                      key={index} 
                      className={`cursor-pointer hover:bg-cyan-500/10 ${startPoint && startPoint[0] === site.r && startPoint[1] === site.c ? 'bg-cyan-950/45 border-l-2 border-cyan-400' : ''}`}
                      onClick={() => handleSelectLandingCandidate(site)}
                    >
                      <td>
                        <div className="font-semibold">{site.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {site.slope}° slope | {site.illumination}% Sun
                        </div>
                      </td>
                      <td className="font-mono text-center font-bold text-white text-sm">
                        {site.score}
                      </td>
                      <td>
                        <span className={`status-badge ${site.status === 'GO' ? 'status-go' : site.status === 'CAUTION' ? 'status-caution' : 'status-nogo'}`}>
                          {site.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Scientific Explanation Info */}
            <div className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-900 pt-3 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-cyan-400 font-semibold uppercase">
                <Sun className="w-3.5 h-3.5" />
                Scientific Insight
              </div>
              <p>
                Landers must target sites with high solar exposure (crater rims) to maintain power. High slopes &gt; 12° carry tipping hazards. Select a site to set the rover departure location.
              </p>
            </div>
          </aside>

          {/* 🗺️ Center Area: Plotly Map Visualizers */}
          <main className="flex flex-col gap-3 min-w-0">
            {/* Visualizer Tabs */}
            <div className="flex items-center justify-between bg-slate-950/45 p-1 rounded-lg border border-slate-800">
              <div className="flex gap-1">
                <button 
                  onClick={() => setActiveTab("3d")}
                  className={`btn-sci-fi ${activeTab === '3d' ? 'btn-cyan' : 'text-slate-400'}`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  3D Elevation surface
                </button>
                <button 
                  onClick={() => setActiveTab("cpr")}
                  className={`btn-sci-fi ${activeTab === 'cpr' ? 'btn-cyan' : 'text-slate-400'}`}
                >
                  <CloudSnow className="w-3.5 h-3.5" />
                  Ice Prob. Map (ML)
                </button>
                <button 
                  onClick={() => setActiveTab("hazard")}
                  className={`btn-sci-fi ${activeTab === 'hazard' ? 'btn-cyan' : 'text-slate-400'}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Slope Hazards Map
                </button>
              </div>

              {terrainData && (
                <div className="text-xs font-mono text-purple-400 mr-2 flex items-center gap-1">
                  <Activity className="w-3 h-3 animate-pulse" />
                  ML Mode: {terrainData.ml_mode}
                </div>
              )}
            </div>

            {/* The Map Plotly Container */}
            <div className="flex-1 glass-panel p-2 min-h-[400px] justify-center relative">
              <div className="scanner-overlay"></div>
              
              {activeTab === '3d' ? (
                <Plot
                  data={get3DPlotData()}
                  layout={{
                    autosize: true,
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { l: 0, r: 0, b: 0, t: 0 },
                    scene: {
                      aspectratio: { x: 1, y: 1, z: 0.45 },
                      xaxis: { title: 'X Coordinate (Grid)', gridcolor: 'rgba(255,255,255,0.05)', color: '#94a3b8', backgroundcolor: 'rgb(2,4,10)' },
                      yaxis: { title: 'Y Coordinate (Grid)', gridcolor: 'rgba(255,255,255,0.05)', color: '#94a3b8', backgroundcolor: 'rgb(2,4,10)' },
                      zaxis: { title: 'Elevation (m)', gridcolor: 'rgba(255,255,255,0.05)', color: '#94a3b8', backgroundcolor: 'rgb(2,4,10)' }
                    },
                    legend: { font: { color: '#94a3b8' } }
                  }}
                  useResizeHandler={true}
                  className="w-full h-full"
                  onClick={handleMapClick}
                />
              ) : (
                <Plot
                  data={getHeatmapData(activeTab)}
                  layout={{
                    autosize: true,
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { l: 40, r: 20, b: 40, t: 20 },
                    xaxis: { gridcolor: 'rgba(255,255,255,0.05)', color: '#94a3b8' },
                    yaxis: { gridcolor: 'rgba(255,255,255,0.05)', color: '#94a3b8' },
                    clickmode: 'event+select'
                  }}
                  useResizeHandler={true}
                  className="w-full h-full"
                  onClick={handleMapClick}
                />
              )}
            </div>

            {/* Interaction Instruction Banner */}
            <div className="bg-slate-950/80 px-4 py-2.5 rounded-lg border border-slate-800 text-xs flex justify-between items-center gap-2">
              <span className="text-slate-400">
                👉 Click map to define: 
                <span className="text-green-400 font-bold ml-1">Lander Start</span> {startPoint ? `[${startPoint[0]}, ${startPoint[1]}]` : "(Not selected)"} 
                and then 
                <span className="text-cyan-400 font-bold ml-2">Rover Target</span> {endPoint ? `[${endPoint[0]}, ${endPoint[1]}]` : "(Not selected)"}
              </span>

              <div className="flex gap-2">
                <span className="text-slate-400 font-mono">Selection Mode:</span>
                <span className={`font-bold uppercase ${selectionMode === 'start' ? 'text-green-400' : 'text-cyan-400'}`}>
                  {selectionMode === 'start' ? 'Place Lander' : 'Place Target'}
                </span>
              </div>
            </div>
          </main>

          {/* 🤖 Right Sidebar: Navigation Telemetry */}
          <aside className="glass-panel gap-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2 mb-1">
                <Compass className="w-4 h-4" />
                Mission Routing Control
              </h2>
              <p className="text-xs text-slate-400">Slope and energy-constrained traversal calculations.</p>
            </div>

            {/* Routing buttons */}
            <div className="flex flex-col gap-2">
              <button 
                onClick={runPathfinder}
                disabled={!startPoint || !endPoint || isPlanning}
                className="btn-sci-fi btn-purple w-full justify-center text-center font-bold"
              >
                {isPlanning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-purple-500/20 border-t-purple-400 rounded-full animate-spin"></div>
                    <span>Computing Optimal Path...</span>
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4" />
                    <span>Calculate Traverse Route</span>
                  </>
                )}
              </button>

              <button 
                onClick={resetRouting}
                className="btn-sci-fi btn-cyan w-full justify-center text-center"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset Coordinates</span>
              </button>
            </div>

            {planError && (
              <div className="p-3 bg-red-950/20 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
                <span>{planError}</span>
              </div>
            )}

            {/* Route metrics displays */}
            <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
              <div className="border-t border-slate-900 pt-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Telemetry Panel</h3>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-900">
                    <div className="text-[10px] text-slate-500 uppercase font-mono mb-1">Distance</div>
                    <div className="metric-value">
                      {routeMetrics ? routeMetrics.distance_km : "—"}
                      <span className="metric-unit">km</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-900">
                    <div className="text-[10px] text-slate-500 uppercase font-mono mb-1">Max Slope</div>
                    <div className="metric-value text-red-400">
                      {routeMetrics ? `${routeMetrics.max_slope}°` : "—"}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-900">
                    <div className="text-[10px] text-slate-500 uppercase font-mono mb-1">Elevation Change</div>
                    <div className="text-xs font-mono font-semibold text-white mt-1">
                      {routeMetrics ? (
                        <>
                          <span className="text-green-400">+{routeMetrics.total_climb_m}m</span> <br />
                          <span className="text-red-400">-{routeMetrics.total_descent_m}m</span>
                        </>
                      ) : "—"}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-900">
                    <div className="text-[10px] text-slate-500 uppercase font-mono mb-1">PSR Exposure</div>
                    <div className="metric-value text-purple-400">
                      {routeMetrics ? `${routeMetrics.shadow_traverse_pct}%` : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {routeMetrics && (
                <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-900 flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span className="text-slate-400 uppercase font-mono flex items-center gap-1">
                      <BatteryCharging className="w-3.5 h-3.5 text-green-400" />
                      Battery Capacity
                    </span>
                    <span className={`${routeMetrics.final_battery_pct > 50 ? 'text-green-400' : routeMetrics.final_battery_pct > 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {routeMetrics.final_battery_pct}%
                    </span>
                  </div>
                  
                  {/* Visual Health bar */}
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${routeMetrics.final_battery_pct > 50 ? 'bg-green-400' : routeMetrics.final_battery_pct > 20 ? 'bg-yellow-400' : 'bg-red-400'}`}
                      style={{ width: `${routeMetrics.final_battery_pct}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Feature importance chart */}
              {terrainData && terrainData.features_importance && (
                <div className="border-t border-slate-900 pt-3">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">ML Feature Contribution</h4>
                  <div className="flex flex-col gap-1.5">
                    {Object.entries(terrainData.features_importance).map(([feature, val]) => (
                      <div key={feature} className="text-xs">
                        <div className="flex justify-between text-slate-400 mb-0.5 font-mono">
                          <span>{feature}</span>
                          <span>{(val * 100).toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden border border-slate-900">
                          <div 
                            className="h-full bg-cyan-400"
                            style={{ width: `${val * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

        </div>
      )}
    </div>
  );
}
