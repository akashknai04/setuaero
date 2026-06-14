import heapq
import numpy as np

class RoverPathfinder:
    def __init__(self, max_slope_limit=15.0):
        self.max_slope_limit = max_slope_limit

    def heuristic(self, a, b):
        """Standard Euclidean distance heuristic."""
        return np.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2)

    def plan_path(self, elevation_grid, slope_grid, illumination_grid, start, end, cell_resolution_m=150.0):
        """
        Plans a path from start to end using energy-aware A* search.
        
        Args:
            elevation_grid: 2D array of elevations
            slope_grid: 2D array of slopes in degrees
            illumination_grid: 2D array of solar illumination values (0 to 1)
            start: tuple (row, col)
            end: tuple (row, col)
            cell_resolution_m: physical size of one grid cell in meters
            
        Returns:
            dict containing:
                - path: list of [row, col] coordinates
                - success: boolean
                - metrics: dict of telemetry details
                - error_message: str
        """
        elev = np.array(elevation_grid)
        slope = np.array(slope_grid)
        illum = np.array(illumination_grid)
        
        rows, cols = elev.shape
        start = (int(start[0]), int(start[1]))
        end = (int(end[0]), int(end[1]))

        # Validate start/end boundaries
        if not (0 <= start[0] < rows and 0 <= start[1] < cols) or not (0 <= end[0] < rows and 0 <= end[1] < cols):
            return {
                "path": [],
                "success": False,
                "metrics": {},
                "error_message": "Start or end coordinates are out of crater map bounds."
            }

        # Check if start or end are on extreme hazards (slopes > max_slope_limit)
        if slope[start] > self.max_slope_limit:
            return {
                "path": [],
                "success": False,
                "metrics": {},
                "error_message": f"Start site has a hazard slope of {slope[start]:.1f}° (> {self.max_slope_limit}°). Landing unsafe."
            }
            
        if slope[end] > self.max_slope_limit:
            return {
                "path": [],
                "success": False,
                "metrics": {},
                "error_message": f"Target ice site has a hazard slope of {slope[end]:.1f}° (> {self.max_slope_limit}°). Rover cannot reach."
            }

        # 8-way connectivity
        directions = [
            (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),   # Orthogonal
            (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414) # Diagonal
        ]

        # Priority Queue: (f_score, current_node, current_g_score)
        open_set = []
        heapq.heappush(open_set, (self.heuristic(start, end), start, 0.0))
        
        # Tracking dictionaries
        came_from = {}
        g_score = {start: 0.0}
        
        # Track path properties during search
        f_score = {start: self.heuristic(start, end)}

        success = False
        while open_set:
            _, current, current_g = heapq.heappop(open_set)

            if current == end:
                success = True
                break

            # Skip outdated heap entries
            if current_g > g_score.get(current, float('inf')):
                continue

            for dr, dc, weight in directions:
                neighbor = (current[0] + dr, current[1] + dc)
                
                # Check boundaries
                if not (0 <= neighbor[0] < rows and 0 <= neighbor[1] < cols):
                    continue

                # Geotechnical Constraint: Obstacle avoidance for slopes > 15 degrees
                n_slope = slope[neighbor]
                if n_slope > self.max_slope_limit:
                    continue

                # Energy-Aware Cost Function
                # Base cost is distance (1.0 or 1.414 cells)
                distance_cost = weight
                
                # Slope Penalty: Quadratic penalty for traversing slopes (more slippage/energy)
                slope_penalty = (n_slope / self.max_slope_limit) ** 2
                
                # Elevation difference: climbing uphill adds energy cost
                elev_diff = elev[neighbor] - elev[current]
                climb_penalty = max(0, elev_diff) * 0.02  # Scale factor for climbing vertical meters

                # Solar charging discount: travelling in sun reduces battery draw
                solar_offset = 0.35 * illum[neighbor]

                # Combined edge weight (power draw unit)
                # Ensure edge weight is strictly positive to prevent A* loops
                edge_cost = distance_cost * (1.0 + 3.0 * slope_penalty + climb_penalty - solar_offset)
                edge_cost = max(0.1, edge_cost)

                tentative_g_score = g_score[current] + edge_cost

                if tentative_g_score < g_score.get(neighbor, float('inf')):
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g_score
                    h = self.heuristic(neighbor, end)
                    f_score[neighbor] = tentative_g_score + h
                    heapq.heappush(open_set, (tentative_g_score + h, neighbor, tentative_g_score))

        if not success:
            return {
                "path": [],
                "success": False,
                "metrics": {},
                "error_message": "No safe route could be found. The target ice is isolated by steep hazards (> 15°)."
            }

        # Reconstruct path
        path = []
        curr = end
        while curr in came_from:
            path.append(list(curr))
            curr = came_from[curr]
        path.append(list(start))
        path.reverse()

        # Calculate rich path telemetry metrics
        path_indices = np.array(path)
        path_rows = path_indices[:, 0]
        path_cols = path_indices[:, 1]
        
        path_slopes = slope[path_rows, path_cols]
        path_elevations = elev[path_rows, path_cols]
        path_illums = illum[path_rows, path_cols]

        # Calculate actual physical distance in kilometers
        total_steps = 0.0
        for i in range(len(path) - 1):
            p1, p2 = path[i], path[i+1]
            step_dist = 1.414 if (p1[0] != p2[0] and p1[1] != p2[1]) else 1.0
            total_steps += step_dist
            
        total_distance_km = (total_steps * cell_resolution_m) / 1000.0

        # Elevation delta (total climb and descent)
        climb = 0.0
        descent = 0.0
        for i in range(len(path_elevations) - 1):
            diff = path_elevations[i+1] - path_elevations[i]
            if diff > 0:
                climb += diff
            else:
                descent += abs(diff)

        # Solar exposure and battery metrics
        # Standard battery capacity is estimated in relative units
        # Base drain: 2% battery per cell step
        # High slope increases battery drain, solar illumination recovers 1% per step
        battery_charge = 100.0
        battery_history = [100.0]
        shadow_steps = 0
        
        for i in range(1, len(path)):
            cell_slope = path_slopes[i]
            cell_illum = path_illums[i]
            
            # Energy cost equation
            energy_draw = 1.5 + (cell_slope / 15.0) * 2.0
            solar_generation = cell_illum * 1.5
            net_loss = energy_draw - solar_generation
            
            battery_charge -= net_loss
            battery_charge = np.clip(battery_charge, 0.0, 100.0)
            battery_history.append(float(battery_charge))
            
            if cell_illum < 0.1:
                shadow_steps += 1

        shadow_ratio = shadow_steps / len(path)

        metrics = {
            "distance_km": round(float(total_distance_km), 2),
            "max_slope": round(float(np.max(path_slopes)), 1),
            "average_slope": round(float(np.mean(path_slopes)), 1),
            "total_climb_m": round(float(climb), 1),
            "total_descent_m": round(float(descent), 1),
            "final_battery_pct": round(float(battery_charge), 1),
            "shadow_traverse_pct": round(float(shadow_ratio * 100), 1),
            "battery_history": battery_history
        }

        return {
            "path": path,
            "success": True,
            "metrics": metrics,
            "error_message": ""
        }

if __name__ == "__main__":
    from data_manager import LunarDataManager
    dm = LunarDataManager()
    c_data = dm.load_crater_data("shackleton", grid_size=50)
    pathfinder = RoverPathfinder()
    
    # Simple test: center of map to top edge
    res = pathfinder.plan_path(
        c_data["elevation"],
        c_data["slope"],
        c_data["illumination"],
        start=(5, 5),
        end=(25, 25)
    )
    print("Pathfinder test completed. Success:", res["success"])
    if res["success"]:
        print("Path length:", len(res["path"]))
        print("Metrics:", res["metrics"].keys())
