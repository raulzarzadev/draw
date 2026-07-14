"use client";

import { Excalidraw } from "@excalidraw/excalidraw";

export default function DrawCanvas() {
  return (
    <main className="app-shell">
      <Excalidraw
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: true,
            clearCanvas: true,
            loadScene: true,
            saveAsImage: true,
            saveToActiveFile: true,
            toggleTheme: true,
          },
        }}
      />
    </main>
  );
}
