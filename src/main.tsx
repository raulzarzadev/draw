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

// Never cache Vite development modules. Production workers update on reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .catch(error => console.error("Could not register Draw offline support", error));
  });
}
