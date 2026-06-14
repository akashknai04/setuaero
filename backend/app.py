from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Tuple

from data_manager import LunarDataManager
from ml_engine import PhysicsInformedMLEngine
from pathfinder import RoverPathfinder

app = FastAPI(
    title="Lunar Ice Pathfinder API",
    description="Backend API for lunar terrain analysis, ML ice classification, and rover routing.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize engines
data_manager = LunarDataManager()
ml_engine = PhysicsInformedMLEngine()
pathfinder = RoverPathfinder()

# Pydantic schemas for request bodies
class PathRequest(BaseModel):
    crater_id: str
    start: Tuple[int, int]
    end: Tuple[int, int]
    grid_size: int = 120

@app.get("/")
def read_root():
    return {"message": "Lunar Ice Pathfinder Backend API is online. Query /api/craters to begin."}

@app.get("/api/craters")
def get_craters():
    """Lists all supported lunar craters with geological metadata."""
    try:
        return data_manager.get_crater_list()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/terrain/{crater_id}")
def get_terrain_data(crater_id: str, grid_size: int = 120):
    """
    Fetches raw elevation/slope datasets and executes the Physics-Informed ML classifier
    to return combined ice-hazard grids.
    """
    try:
        # 1. Load terrain features
        terrain = data_manager.load_crater_data(crater_id, grid_size=grid_size)
        
        # 2. Execute ML classifier for ice distribution
        ml_results = ml_engine.predict_ice_distribution(
            elevation=terrain["elevation"],
            slope=terrain["slope"],
            illumination=terrain["illumination"],
            cpr=terrain["cpr"],
            temperature=terrain["temperature"]
        )
        
        # 3. Fuse data sets into single payload
        payload = {
            "crater_id": crater_id,
            "grid_size": grid_size,
            "elevation": terrain["elevation"],
            "slope": terrain["slope"],
            "illumination": terrain["illumination"],
            "cpr": terrain["cpr"],
            "temperature": terrain["temperature"],
            "ice_probability": ml_results["ice_probability"],
            "ml_mode": ml_results["ml_mode"],
            "features_importance": ml_results["features_importance"]
        }
        return payload
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/plan-path")
def plan_route(request: PathRequest):
    """
    Calculates the energy and slope-constrained A* rover traverse route.
    """
    try:
        # 1. Load terrain features
        terrain = data_manager.load_crater_data(request.crater_id, grid_size=request.grid_size)
        
        # 2. Plan path
        route_results = pathfinder.plan_path(
            elevation_grid=terrain["elevation"],
            slope_grid=terrain["slope"],
            illumination_grid=terrain["illumination"],
            start=request.start,
            end=request.end
        )
        
        if not route_results["success"]:
            raise HTTPException(status_code=400, detail=route_results["error_message"])
            
        return {
            "path": route_results["path"],
            "metrics": route_results["metrics"]
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
