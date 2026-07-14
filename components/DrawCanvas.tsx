"use client";

import PocketBaseClient from "pocketbase";
import type PocketBase from "pocketbase";
import type { AuthModel } from "pocketbase";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SceneData = {
  type?: string;
  version?: number;
  source?: string;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

type Drawing = {
  id: string;
  title: string;
  scene: SceneData;
  created: string;
  updated: string;
};

type ExcalidrawModule = {
  Excalidraw: ComponentType<{
    initialData: SceneData;
    onChange: (elements: unknown[], appState: unknown, files: unknown) => void;
    UIOptions: Record<string, unknown>;
  }>;
  serializeAsJSON: (
    elements: unknown[],
    appState: unknown,
    files: unknown,
    localAppState: "local" | "database",
  ) => string;
};

const pocketBaseUrl =
  import.meta.env.VITE_POCKETBASE_URL ?? "https://pb.raulzarza.com";

const emptyScene = (): SceneData => ({
  type: "excalidraw",
  version: 2,
  source: "https://draw.raulzarza.com",
  elements: [],
  appState: {
    viewBackgroundColor: "#ffffff",
  },
  files: {},
});

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const getEmail = (user: AuthModel) => {
  if (!user || typeof user !== "object" || !("email" in user)) {
    return "";
  }

  return String(user.email ?? "");
};

export default function DrawCanvas() {
  const pb = useMemo(() => new PocketBaseClient(pocketBaseUrl), []);

  return <DrawWorkspace pb={pb} />;
}

function DrawWorkspace({ pb }: { pb: PocketBase }) {
  const [user, setUser] = useState<AuthModel>(pb.authStore.record);
  const [authReady, setAuthReady] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [status, setStatus] = useState("Ready");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScene = useRef<SceneData | null>(null);

  const activeDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === activeId) ?? null,
    [activeId, drawings],
  );

  const loadDrawings = useCallback(async () => {
    setStatus("Loading drawings...");

    try {
      const nextDrawings = await pb.collection("drawings").getFullList<Drawing>({
        sort: "-updated",
        fields: "id,title,scene,created,updated",
      });

      setDrawings(nextDrawings);
      setActiveId((current) => current ?? nextDrawings[0]?.id ?? null);
      setStatus(nextDrawings.length ? "Ready" : "Create your first drawing");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load drawings");
    }
  }, [pb]);

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(
      () => {
        setUser(pb.authStore.record);
        setDrawings([]);
        setActiveId(null);
      },
      true,
    );

    setAuthReady(true);
    return unsubscribe;
  }, [pb]);

  useEffect(() => {
    if (user) {
      void loadDrawings();
    }
  }, [loadDrawings, user]);

  const createDrawing = useCallback(async () => {
    if (!user) {
      return;
    }

    setStatus("Creating...");

    try {
      const drawing = await pb.collection("drawings").create<Drawing>({
        owner: user.id,
        title: "Untitled drawing",
        scene: emptyScene(),
      });

      setDrawings((items) => [drawing, ...items]);
      setActiveId(drawing.id);
      setStatus("Created");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create drawing");
    }
  }, [pb, user]);

  const renameDrawing = useCallback(
    async (drawing: Drawing, title: string) => {
      const nextTitle = title.trim() || "Untitled drawing";
      setDrawings((items) =>
        items.map((item) =>
          item.id === drawing.id ? { ...item, title: nextTitle } : item,
        ),
      );

      try {
        await pb.collection("drawings").update(drawing.id, { title: nextTitle });
        setStatus("Renamed");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not rename");
      }
    },
    [pb],
  );

  const deleteDrawing = useCallback(
    async (drawing: Drawing) => {
      try {
        await pb.collection("drawings").delete(drawing.id);
        setDrawings((items) => {
          const next = items.filter((item) => item.id !== drawing.id);
          setActiveId(next[0]?.id ?? null);
          return next;
        });
        setStatus("Deleted");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not delete");
      }
    },
    [pb],
  );

  const duplicateDrawing = useCallback(
    async (drawing: Drawing) => {
      if (!user) {
        return;
      }

      try {
        const duplicate = await pb.collection("drawings").create<Drawing>({
          owner: user.id,
          title: `${drawing.title} copy`,
          scene: drawing.scene,
        });

        setDrawings((items) => [duplicate, ...items]);
        setActiveId(duplicate.id);
        setStatus("Duplicated");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not duplicate");
      }
    },
    [pb, user],
  );

  const saveScene = useCallback(
    async (drawingId: string, scene: SceneData) => {
      setStatus("Saving...");

      try {
        const updated = await pb
          .collection("drawings")
          .update<Pick<Drawing, "updated">>(drawingId, { scene }, { fields: "updated" });

        setDrawings((items) =>
          items.map((item) =>
            item.id === drawingId ? { ...item, scene, updated: updated.updated } : item,
          ),
        );
        setStatus("Saved");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not save");
      }
    },
    [pb],
  );

  const scheduleSave = useCallback(
    (scene: SceneData) => {
      if (!activeDrawing) {
        return;
      }

      latestScene.current = scene;

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        if (latestScene.current) {
          void saveScene(activeDrawing.id, latestScene.current);
        }
      }, 1800);
    },
    [activeDrawing, saveScene],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  if (!authReady) {
    return <CenteredStatus title="Draw" message="Checking session..." />;
  }

  if (!user) {
    return <AuthPanel pb={pb} />;
  }

  return (
    <main className={`draw-workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="draw-sidebar">
        <div className="sidebar-header">
          <button
            aria-label={sidebarCollapsed ? "Show drawings" : "Hide drawings"}
            className="icon-button"
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? "=" : "<"}
          </button>
          <div className="sidebar-title">
            <p className="eyebrow">Draw</p>
            <h1>My drawings</h1>
          </div>
          <button
            aria-label="Create drawing"
            className="icon-button"
            type="button"
            onClick={createDrawing}
          >
            +
          </button>
        </div>

        {!sidebarCollapsed ? (
          <>
            <div className="drawing-list">
              {drawings.map((drawing) => (
                <button
                  className={`drawing-row ${drawing.id === activeId ? "active" : ""}`}
                  key={drawing.id}
                  type="button"
                  onClick={() => setActiveId(drawing.id)}
                >
                  <span>{drawing.title}</span>
                  <small>{formatTime(drawing.updated)}</small>
                </button>
              ))}
            </div>

            <div className="account-panel">
              <span>{getEmail(user)}</span>
              <button type="button" onClick={() => pb.authStore.clear()}>
                Sign out
              </button>
            </div>
          </>
        ) : null}
      </aside>

      <section className="canvas-column">
        {activeDrawing ? (
          <>
            <div className="canvas-toolbar">
              <input
                aria-label="Drawing title"
                defaultValue={activeDrawing.title}
                key={activeDrawing.id}
                onBlur={(event) =>
                  void renameDrawing(activeDrawing, event.currentTarget.value)
                }
              />
              <div className="toolbar-actions">
                <button
                  type="button"
                  onClick={() => void duplicateDrawing(activeDrawing)}
                >
                  Duplicate
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => void deleteDrawing(activeDrawing)}
                >
                  Delete
                </button>
                <span>{status}</span>
              </div>
            </div>
            <DrawingEditor
              key={activeDrawing.id}
              drawing={activeDrawing}
              scheduleSave={scheduleSave}
            />
          </>
        ) : (
          <div className="empty-state">
            <h2>No drawings yet</h2>
            <button type="button" onClick={createDrawing}>
              Create drawing
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function DrawingEditor({
  drawing,
  scheduleSave,
}: {
  drawing: Drawing;
  scheduleSave: (scene: SceneData) => void;
}) {
  const [module, setModule] = useState<ExcalidrawModule | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;

    import("@excalidraw/excalidraw")
      .then((nextModule) => {
        if (!cancelled) {
          setModule(nextModule as ExcalidrawModule);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Could not load canvas",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <div className="empty-state">
        <h2>Canvas could not load</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="empty-state">
        <h2>Loading canvas...</h2>
      </div>
    );
  }

  const { Excalidraw, serializeAsJSON } = module;

  return (
    <div className="canvas-frame">
      <Excalidraw
        initialData={drawing.scene}
        onChange={(elements, appState, files) => {
          const serialized = serializeAsJSON(elements, appState, files, "local");
          scheduleSave(JSON.parse(serialized) as SceneData);
        }}
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
    </div>
  );
}

function AuthPanel({ pb }: { pb: PocketBase }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const submit = async () => {
    setStatus("Working...");

    try {
      if (mode === "signin") {
        await pb.collection("users").authWithPassword(email, password);
        setStatus("Signed in");
        return;
      }

      await pb.collection("users").create({
        email,
        password,
        passwordConfirm: password,
      });
      await pb.collection("users").authWithPassword(email, password);
      setStatus("Account created");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Auth failed");
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">Draw</p>
        <h1>{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder="Email"
          type="email"
          value={email}
        />
        <input
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          onChange={(event) => setPassword(event.currentTarget.value)}
          placeholder="Password"
          type="password"
          value={password}
        />
        <button type="button" onClick={() => void submit()}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Need an account?" : "Already have an account?"}
        </button>
        {status ? <p className="auth-status">{status}</p> : null}
      </section>
    </main>
  );
}

function CenteredStatus({ title, message }: { title: string; message: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">{title}</p>
        <h1>{message}</h1>
      </section>
    </main>
  );
}
