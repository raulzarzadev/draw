"use client";

import {
  Excalidraw,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
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
  created_at: string;
  updated_at: string;
};

type ConfigState =
  | { status: "loading" }
  | { status: "missing" }
  | {
      status: "ready";
      supabase: SupabaseClient;
    };

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

export default function DrawCanvas() {
  const [config, setConfig] = useState<ConfigState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/supabase-config")
      .then((response) => response.json())
      .then((payload: { configured: boolean; url: string; anonKey: string }) => {
        if (cancelled) {
          return;
        }

        if (!payload.configured) {
          setConfig({ status: "missing" });
          return;
        }

        setConfig({
          status: "ready",
          supabase: createClient(payload.url, payload.anonKey),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({ status: "missing" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (config.status === "loading") {
    return <CenteredStatus title="Draw" message="Loading..." />;
  }

  if (config.status === "missing") {
    return (
      <CenteredStatus
        title="Supabase setup needed"
        message="Set SUPABASE_URL and SUPABASE_ANON_KEY in the site environment."
      />
    );
  }

  return <DrawWorkspace supabase={config.supabase} />;
}

function DrawWorkspace({ supabase }: { supabase: SupabaseClient }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScene = useRef<SceneData | null>(null);

  const activeDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === activeId) ?? null,
    [activeId, drawings],
  );

  const loadDrawings = useCallback(async () => {
    setStatus("Loading drawings...");
    const { data, error } = await supabase
      .from("drawings")
      .select("id,title,scene,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      setStatus(error.message);
      return;
    }

    const nextDrawings = (data ?? []) as Drawing[];
    setDrawings(nextDrawings);
    setActiveId((current) => current ?? nextDrawings[0]?.id ?? null);
    setStatus(nextDrawings.length ? "Ready" : "Create your first drawing");
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setDrawings([]);
      setActiveId(null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

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
    const { data, error } = await supabase
      .from("drawings")
      .insert({
        owner_id: user.id,
        title: "Untitled drawing",
        scene: emptyScene(),
      })
      .select("id,title,scene,created_at,updated_at")
      .single();

    if (error) {
      setStatus(error.message);
      return;
    }

    setDrawings((items) => [data as Drawing, ...items]);
    setActiveId((data as Drawing).id);
    setStatus("Created");
  }, [supabase, user]);

  const renameDrawing = useCallback(
    async (drawing: Drawing, title: string) => {
      const nextTitle = title.trim() || "Untitled drawing";
      setDrawings((items) =>
        items.map((item) =>
          item.id === drawing.id ? { ...item, title: nextTitle } : item,
        ),
      );

      const { error } = await supabase
        .from("drawings")
        .update({ title: nextTitle })
        .eq("id", drawing.id);

      setStatus(error ? error.message : "Renamed");
    },
    [supabase],
  );

  const deleteDrawing = useCallback(
    async (drawing: Drawing) => {
      const { error } = await supabase.from("drawings").delete().eq("id", drawing.id);

      if (error) {
        setStatus(error.message);
        return;
      }

      setDrawings((items) => {
        const next = items.filter((item) => item.id !== drawing.id);
        setActiveId(next[0]?.id ?? null);
        return next;
      });
      setStatus("Deleted");
    },
    [supabase],
  );

  const duplicateDrawing = useCallback(
    async (drawing: Drawing) => {
      if (!user) {
        return;
      }

      const { data, error } = await supabase
        .from("drawings")
        .insert({
          owner_id: user.id,
          title: `${drawing.title} copy`,
          scene: drawing.scene,
        })
        .select("id,title,scene,created_at,updated_at")
        .single();

      if (error) {
        setStatus(error.message);
        return;
      }

      setDrawings((items) => [data as Drawing, ...items]);
      setActiveId((data as Drawing).id);
      setStatus("Duplicated");
    },
    [supabase, user],
  );

  const saveScene = useCallback(
    async (drawingId: string, scene: SceneData) => {
      setStatus("Saving...");
      const { data, error } = await supabase
        .from("drawings")
        .update({ scene })
        .eq("id", drawingId)
        .select("updated_at")
        .single();

      if (error) {
        setStatus(error.message);
        return;
      }

      const updatedAt = (data as Pick<Drawing, "updated_at">).updated_at;
      setDrawings((items) =>
        items.map((item) =>
          item.id === drawingId ? { ...item, scene, updated_at: updatedAt } : item,
        ),
      );
      setStatus("Saved");
    },
    [supabase],
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
    return <AuthPanel supabase={supabase} />;
  }

  return (
    <main className="draw-workspace">
      <aside className="draw-sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Draw</p>
            <h1>My drawings</h1>
          </div>
          <button className="icon-button" type="button" onClick={createDrawing}>
            +
          </button>
        </div>

        <div className="drawing-list">
          {drawings.map((drawing) => (
            <button
              className={`drawing-row ${drawing.id === activeId ? "active" : ""}`}
              key={drawing.id}
              type="button"
              onClick={() => setActiveId(drawing.id)}
            >
              <span>{drawing.title}</span>
              <small>{formatTime(drawing.updated_at)}</small>
            </button>
          ))}
        </div>

        <div className="account-panel">
          <span>{user.email}</span>
          <button type="button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
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
            <div className="canvas-frame">
              <Excalidraw
                key={activeDrawing.id}
                initialData={activeDrawing.scene}
                onChange={(elements, appState, files) => {
                  const serialized = serializeAsJSON(
                    elements,
                    appState,
                    files,
                    "local",
                  );
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

function AuthPanel({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const submit = async () => {
    setStatus("Working...");
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setStatus(
      result.error
        ? result.error.message
        : mode === "signin"
          ? "Signed in"
          : "Account created. Check your email if confirmation is enabled.",
    );
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
