import "@excalidraw/excalidraw/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/styles.css";
import DrawCanvas from "../components/DrawCanvas";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DrawCanvas />
  </StrictMode>,
);
