import { createRoot } from "react-dom/client";
import { TideGraphWidget } from "./TideGraphWidget";
import "./widgets.css";

createRoot(document.getElementById("root")!).render(<TideGraphWidget />);
