import sys
import os

# Ensure the backend directory is in python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

from data_manager import LunarDataManager, CRATER_METADATA
from ml_engine import PhysicsInformedMLEngine
from pathfinder import RoverPathfinder

def run_tests():
    print("==================================================")
    print("         LUNAR PATHFINDER BACKEND UNIT TESTS      ")
    print("==================================================")

    # Test 1: Data Manager and Crater Metadata
    print("\n[Test 1] Testing Data Manager...")
    dm = LunarDataManager()
    craters = dm.get_crater_list()
    assert len(craters) == 3, f"Expected 3 craters, got {len(craters)}"
    print("[OK] Successfully listed craters.")
    
    # Test Shackleton loading
    grid_size = 80
    data = dm.load_crater_data("shackleton", grid_size=grid_size)
    for field in ["elevation", "slope", "illumination", "cpr", "temperature"]:
        assert field in data, f"Missing {field} in loaded data"
        assert len(data[field]) == grid_size, f"Field {field} rows mismatch: expected {grid_size}, got {len(data[field])}"
        assert len(data[field][0]) == grid_size, f"Field {field} cols mismatch: expected {grid_size}, got {len(data[field][0])}"
    print("[OK] Successfully loaded synthetic Shackleton data with dimensions 80x80.")

    # Test 2: ML Engine
    print("\n[Test 2] Testing Physics-Informed ML Engine...")
    ml = PhysicsInformedMLEngine()
    ml_results = ml.predict_ice_distribution(
        data["elevation"],
        data["slope"],
        data["illumination"],
        data["cpr"],
        data["temperature"]
    )
    
    assert "ice_probability" in ml_results, "Missing 'ice_probability' in ML output"
    assert "features_importance" in ml_results, "Missing 'features_importance' in ML output"
    assert "ml_mode" in ml_results, "Missing 'ml_mode' in ML output"
    
    assert len(ml_results["ice_probability"]) == grid_size, "Ice probability dimensions mismatch"
    print(f"[OK] ML Engine executed successfully using mode: {ml_results['ml_mode']}")
    print("Feature Importances:", ml_results["features_importance"])

    # Test 3: Pathfinder
    print("\n[Test 3] Testing A* Pathfinder...")
    pf = RoverPathfinder(max_slope_limit=15.0)
    
    # Define start (rim, usually low slope) and end (inside basin, low slope, high ice probability)
    # With grid size 80, the rim is approximately R = 0.6 from center.
    # Center is (40, 40). Rim is at R = 48 pixels away. Let's start at (24, 24) and end at (38, 38).
    start_node = (24, 24)
    end_node = (38, 38)
    
    # Set slopes of start and end nodes to be safe (under 15 deg) just in case noise made them steep
    temp_slope = [list(row) for row in data["slope"]]
    temp_slope[start_node[0]][start_node[1]] = 5.0
    temp_slope[end_node[0]][end_node[1]] = 2.0
    
    route = pf.plan_path(
        elevation_grid=data["elevation"],
        slope_grid=temp_slope,
        illumination_grid=data["illumination"],
        start=start_node,
        end=end_node
    )
    
    assert route["success"], f"Pathfinding failed: {route.get('error_message', 'Unknown error')}"
    assert len(route["path"]) > 0, "Planned path was empty"
    metrics = route["metrics"]
    assert "distance_km" in metrics, "Missing distance metric"
    assert "max_slope" in metrics, "Missing max slope metric"
    assert "final_battery_pct" in metrics, "Missing battery metric"
    
    print("[OK] A* Pathfinder successfully routed rover.")
    print(f"Path Length: {len(route['path'])} steps")
    print(f"Traverse Distance: {metrics['distance_km']} km")
    print(f"Max Slope Encountered: {metrics['max_slope']}°")
    print(f"Final Battery Capacity: {metrics['final_battery_pct']}%")

    print("\n==================================================")
    print("           ALL BACKEND TESTS PASSED               ")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
