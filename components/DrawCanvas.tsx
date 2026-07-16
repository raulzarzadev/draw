"use client";

import PocketBaseClient from "pocketbase";
import type PocketBase from "pocketbase";
import type { AuthModel } from "pocketbase";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Locale = "es" | "en";
type IconName =
  | "chevronLeft"
  | "chevronRight"
  | "cloud"
  | "copy"
  | "logOut"
  | "menu"
  | "plus"
  | "trash"
  | "user"
  | "x";

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
    langCode?: string;
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
const localDrawingId = "local-free-drawing";
const localDrawingStorageKey = "draw-local-drawing";

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

const createLocalDrawing = (title: string): Drawing => {
  const now = new Date().toISOString();

  return {
    id: localDrawingId,
    title,
    scene: emptyScene(),
    created: now,
    updated: now,
  };
};

const isDrawing = (value: unknown): value is Drawing => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const drawing = value as Partial<Drawing>;
  return (
    typeof drawing.id === "string" &&
    typeof drawing.title === "string" &&
    typeof drawing.created === "string" &&
    typeof drawing.updated === "string" &&
    !!drawing.scene &&
    typeof drawing.scene === "object"
  );
};

const loadLocalDrawing = (title: string): Drawing => {
  if (typeof window === "undefined") {
    return createLocalDrawing(title);
  }

  const rawDrawing = window.localStorage.getItem(localDrawingStorageKey);

  if (!rawDrawing) {
    return createLocalDrawing(title);
  }

  try {
    const parsed = JSON.parse(rawDrawing) as unknown;
    return isDrawing(parsed) ? { ...parsed, id: localDrawingId } : createLocalDrawing(title);
  } catch {
    return createLocalDrawing(title);
  }
};

const saveLocalDrawing = (drawing: Drawing) => {
  window.localStorage.setItem(
    localDrawingStorageKey,
    JSON.stringify({ ...drawing, id: localDrawingId }),
  );
};

const translations = {
  es: {
    appName: "Draw",
    auth: {
      changeEmail: "Cambiar correo",
      checkingSession: "Revisando sesion...",
      cloudPrompt:
        "Escribe tu correo y te enviamos un codigo para entrar. Sin contrasenas.",
      code: "Codigo",
      codeRequired: "Escribe el codigo.",
      codeSentTo: "Codigo enviado a",
      createAccount: "Crear cuenta",
      email: "Correo",
      emailRequired: "Escribe tu correo.",
      invalidCode: "Codigo invalido o expirado.",
      resendCode: "Reenviar codigo",
      sendCode: "Enviar codigo",
      sendError: "No se pudo enviar el codigo. Intenta mas tarde.",
      signIn: "Iniciar sesion",
      signedIn: "Sesion iniciada",
      working: "Procesando...",
    },
    labels: {
      cloudSave: "Guardar en nube",
      close: "Cerrar",
      createDrawing: "Crear dibujo",
      delete: "Eliminar",
      duplicate: "Duplicar",
      freePlan: "Gratis local",
      hideDrawings: "Ocultar dibujos",
      language: "Idioma",
      showDrawings: "Mostrar dibujos",
      signOut: "Salir",
      title: "Titulo del dibujo",
    },
    status: {
      accountRequiredForCloud:
        "Crea una cuenta para guardar en la nube y tener mas pizarras.",
      accountRequiredForMore: "Crea una cuenta para crear mas pizarras.",
      canvasLoadError: "No se pudo cargar el canvas",
      canvasLoading: "Cargando canvas...",
      couldNotCreate: "No se pudo crear el dibujo",
      couldNotDelete: "No se pudo eliminar",
      couldNotDuplicate: "No se pudo duplicar",
      couldNotLoad: "No se pudieron cargar los dibujos",
      couldNotRename: "No se pudo renombrar",
      couldNotSave: "No se pudo guardar",
      createFirst: "Crea tu primer dibujo",
      created: "Creado",
      creating: "Creando...",
      deleted: "Eliminado",
      duplicated: "Duplicado",
      loading: "Cargando dibujos...",
      noDrawings: "Aun no hay dibujos",
      ready: "Listo",
      renamed: "Renombrado",
      saved: "Guardado",
      savedLocally: "Guardado local",
      saving: "Guardando...",
    },
    terms: {
      copySuffix: "copia",
      myDrawings: "Mis dibujos",
      untitledDrawing: "Dibujo sin titulo",
    },
  },
  en: {
    appName: "Draw",
    auth: {
      changeEmail: "Change email",
      checkingSession: "Checking session...",
      cloudPrompt:
        "Enter your email and we'll send you a code to sign in. No passwords.",
      code: "Code",
      codeRequired: "Enter the code.",
      codeSentTo: "Code sent to",
      createAccount: "Create account",
      email: "Email",
      emailRequired: "Enter your email.",
      invalidCode: "Invalid or expired code.",
      resendCode: "Resend code",
      sendCode: "Send code",
      sendError: "Could not send the code. Try again later.",
      signIn: "Sign in",
      signedIn: "Signed in",
      working: "Working...",
    },
    labels: {
      cloudSave: "Save to cloud",
      close: "Close",
      createDrawing: "Create drawing",
      delete: "Delete",
      duplicate: "Duplicate",
      freePlan: "Free local",
      hideDrawings: "Hide drawings",
      language: "Language",
      showDrawings: "Show drawings",
      signOut: "Sign out",
      title: "Drawing title",
    },
    status: {
      accountRequiredForCloud:
        "Create an account to save to the cloud and keep more boards.",
      accountRequiredForMore: "Create an account to create more boards.",
      canvasLoadError: "Canvas could not load",
      canvasLoading: "Loading canvas...",
      couldNotCreate: "Could not create drawing",
      couldNotDelete: "Could not delete",
      couldNotDuplicate: "Could not duplicate",
      couldNotLoad: "Could not load drawings",
      couldNotRename: "Could not rename",
      couldNotSave: "Could not save",
      createFirst: "Create your first drawing",
      created: "Created",
      creating: "Creating...",
      deleted: "Deleted",
      duplicated: "Duplicated",
      loading: "Loading drawings...",
      noDrawings: "No drawings yet",
      ready: "Ready",
      renamed: "Renamed",
      saved: "Saved",
      savedLocally: "Saved locally",
      saving: "Saving...",
    },
    terms: {
      copySuffix: "copy",
      myDrawings: "My drawings",
      untitledDrawing: "Untitled drawing",
    },
  },
} as const;

const getInitialLocale = (): Locale => {
  if (typeof window === "undefined") {
    return "es";
  }

  return window.localStorage.getItem("draw-locale") === "en" ? "en" : "es";
};

const formatTime = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const getEmail = (user: AuthModel) => {
  if (!user || typeof user !== "object" || !("email" in user)) {
    return "";
  }

  return String(user.email ?? "");
};

const generateRandomPassword = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export default function DrawCanvas() {
  const pb = useMemo(() => new PocketBaseClient(pocketBaseUrl), []);
  const [locale, setLocale] = useState<Locale>(getInitialLocale);

  const changeLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    window.localStorage.setItem("draw-locale", nextLocale);
  };

  return <DrawWorkspace locale={locale} pb={pb} setLocale={changeLocale} />;
}

function DrawWorkspace({
  locale,
  pb,
  setLocale,
}: {
  locale: Locale;
  pb: PocketBase;
  setLocale: (locale: Locale) => void;
}) {
  const t = translations[locale];
  const [user, setUser] = useState<AuthModel>(pb.authStore.record);
  const [authReady, setAuthReady] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [status, setStatus] = useState(t.status.ready);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScene = useRef<SceneData | null>(null);
  const localDraftToImport = useRef<Drawing | null>(null);
  const isCloudAccount = !!user;

  useEffect(() => {
    setStatus((current) =>
      current === translations.es.status.ready || current === translations.en.status.ready
        ? t.status.ready
        : current,
    );
  }, [t.status.ready]);

  const activeDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === activeId) ?? null,
    [activeId, drawings],
  );

  const openAuthPrompt = useCallback(
    (message?: string, importCurrentDrawing = false) => {
      if (importCurrentDrawing && !user && activeDrawing) {
        localDraftToImport.current = activeDrawing;
      }

      setAuthPromptOpen(true);
      if (message) {
        setStatus(message);
      }
    },
    [activeDrawing, user],
  );

  const closeAuthPrompt = useCallback(() => setAuthPromptOpen(false), []);

  const loadFreeDrawing = useCallback(() => {
    const drawing = loadLocalDrawing("");
    setDrawings([drawing]);
    setActiveId(drawing.id);
    setStatus(t.status.savedLocally);
  }, [t.status.savedLocally]);

  const loadDrawings = useCallback(async (drawingToImport?: Drawing | null) => {
    setStatus(t.status.loading);

    try {
      const nextDrawings = await pb.collection("drawings").getFullList<Drawing>({
        sort: "-updated",
        fields: "id,title,scene,created,updated",
      });
      const importedDrawing =
        drawingToImport && user
          ? await pb.collection("drawings").create<Drawing>({
              owner: user.id,
              title: drawingToImport.title,
              scene: drawingToImport.scene,
            })
          : null;
      const allDrawings = importedDrawing
        ? [importedDrawing, ...nextDrawings]
        : nextDrawings;

      if (importedDrawing) {
        localDraftToImport.current = null;
      }
      setDrawings(allDrawings);
      setActiveId((current) => current ?? allDrawings[0]?.id ?? null);
      setStatus(
        importedDrawing
          ? t.status.saved
          : allDrawings.length
            ? t.status.ready
            : t.status.createFirst,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.status.couldNotLoad);
    }
  }, [
    pb,
    t.status.couldNotLoad,
    t.status.createFirst,
    t.status.loading,
    t.status.ready,
    t.status.saved,
    user,
  ]);

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
    const mediaQuery = window.matchMedia("(max-width: 700px)");
    const syncSidebar = () => setSidebarCollapsed(mediaQuery.matches);

    syncSidebar();
    mediaQuery.addEventListener("change", syncSidebar);
    return () => mediaQuery.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (user) {
      setAuthPromptMode(null);
      void loadDrawings(localDraftToImport.current);
      return;
    }
    loadFreeDrawing();
  }, [loadDrawings, loadFreeDrawing, user]);

  const createDrawing = useCallback(async () => {
    if (!user) {
      openAuthPrompt(t.status.accountRequiredForMore, true);
      return;
    }

    setStatus(t.status.creating);

    try {
      const drawing = await pb.collection("drawings").create<Drawing>({
        owner: user.id,
        title: "",
        scene: emptyScene(),
      });

      setDrawings((items) => [drawing, ...items]);
      setActiveId(drawing.id);
      setStatus(t.status.created);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.status.couldNotCreate);
    }
  }, [
    pb,
    t.status.couldNotCreate,
    t.status.created,
    t.status.creating,
    t.status.accountRequiredForMore,
    openAuthPrompt,
    user,
  ]);

  const renameDrawing = useCallback(
    async (drawing: Drawing, title: string) => {
      const nextTitle = title.trim();
      const nextDrawing = { ...drawing, title: nextTitle, updated: new Date().toISOString() };

      setDrawings((items) =>
        items.map((item) =>
          item.id === drawing.id ? nextDrawing : item,
        ),
      );

      if (!user) {
        localDraftToImport.current = nextDrawing;
        saveLocalDrawing(nextDrawing);
        setStatus(t.status.savedLocally);
        return;
      }

      try {
        await pb.collection("drawings").update(drawing.id, { title: nextTitle });
        setStatus(t.status.renamed);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t.status.couldNotRename);
      }
    },
    [
      pb,
      t.status.couldNotRename,
      t.status.renamed,
      t.status.savedLocally,
      user,
    ],
  );

  const deleteDrawing = useCallback(
    async (drawing: Drawing) => {
      if (!user) {
        const nextDrawing = createLocalDrawing("");
        saveLocalDrawing(nextDrawing);
        localDraftToImport.current = null;
        setDrawings([nextDrawing]);
        setActiveId(nextDrawing.id);
        setStatus(t.status.savedLocally);
        return;
      }

      try {
        await pb.collection("drawings").delete(drawing.id);
        setDrawings((items) => {
          const next = items.filter((item) => item.id !== drawing.id);
          setActiveId(next[0]?.id ?? null);
          return next;
        });
        setStatus(t.status.deleted);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t.status.couldNotDelete);
      }
    },
    [pb, t.status.couldNotDelete, t.status.deleted, t.status.savedLocally, user],
  );

  const duplicateDrawing = useCallback(
    async (drawing: Drawing) => {
      if (!user) {
        openAuthPrompt(t.status.accountRequiredForMore, true);
        return;
      }

      try {
        const duplicate = await pb.collection("drawings").create<Drawing>({
          owner: user.id,
          title: drawing.title.trim()
            ? `${drawing.title} ${t.terms.copySuffix}`
            : `${t.terms.untitledDrawing} ${t.terms.copySuffix}`,
          scene: drawing.scene,
        });

        setDrawings((items) => [duplicate, ...items]);
        setActiveId(duplicate.id);
        setStatus(t.status.duplicated);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t.status.couldNotDuplicate);
      }
    },
    [
      pb,
      t.status.accountRequiredForMore,
      t.status.couldNotDuplicate,
      t.status.duplicated,
      t.terms.copySuffix,
      openAuthPrompt,
      user,
    ],
  );

  const saveScene = useCallback(
    async (drawingId: string, scene: SceneData) => {
      if (!user) {
        const updated = new Date().toISOString();
        let nextDrawing: Drawing | null = null;

        setDrawings((items) =>
          items.map((item) => {
            if (item.id !== drawingId) {
              return item;
            }

            nextDrawing = { ...item, scene, updated };
            return nextDrawing;
          }),
        );

        if (nextDrawing) {
          localDraftToImport.current = nextDrawing;
          saveLocalDrawing(nextDrawing);
        }
        setStatus(t.status.savedLocally);
        return;
      }

      setStatus(t.status.saving);

      try {
        const updated = await pb
          .collection("drawings")
          .update<Pick<Drawing, "updated">>(drawingId, { scene }, { fields: "updated" });

        setDrawings((items) =>
          items.map((item) =>
            item.id === drawingId ? { ...item, scene, updated: updated.updated } : item,
          ),
        );
        setStatus(t.status.saved);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t.status.couldNotSave);
      }
    },
    [pb, t.status.couldNotSave, t.status.saved, t.status.savedLocally, t.status.saving, user],
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
    return <CenteredStatus title={t.appName} message={t.auth.checkingSession} />;
  }

  return (
    <main className={`draw-workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="draw-sidebar">
        <div className="sidebar-header">
          <button
            aria-label={sidebarCollapsed ? t.labels.showDrawings : t.labels.hideDrawings}
            className="icon-button"
            title={sidebarCollapsed ? t.labels.showDrawings : t.labels.hideDrawings}
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <Icon name={sidebarCollapsed ? "chevronRight" : "chevronLeft"} />
          </button>
          <div className="sidebar-title">
            <p className="eyebrow">{t.appName}</p>
            <h1>{t.terms.myDrawings}</h1>
          </div>
          <button
            aria-label={t.labels.createDrawing}
            className="icon-button"
            title={t.labels.createDrawing}
            type="button"
            onClick={createDrawing}
          >
            <Icon name="plus" />
          </button>
        </div>

        {!sidebarCollapsed ? (
          <>
            <div className="drawing-list">
              {drawings.map((drawing) => (
                <div
                  className={`drawing-row ${drawing.id === activeId ? "active" : ""}`}
                  key={drawing.id}
                >
                  <button
                    className="drawing-row-main"
                    type="button"
                    onClick={() => setActiveId(drawing.id)}
                  >
                    <span className={drawing.title.trim() ? "" : "untitled"}>
                      {drawing.title.trim() || t.terms.untitledDrawing}
                    </span>
                    <small>{formatTime(drawing.updated, locale)}</small>
                  </button>
                  <div className="drawing-row-actions">
                    <button
                      aria-label={t.labels.duplicate}
                      className="icon-button"
                      title={t.labels.duplicate}
                      type="button"
                      onClick={() => void duplicateDrawing(drawing)}
                    >
                      <Icon name="copy" />
                    </button>
                    <button
                      aria-label={t.labels.delete}
                      className="icon-button danger"
                      title={t.labels.delete}
                      type="button"
                      onClick={() => void deleteDrawing(drawing)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="account-panel">
              <span>{user ? getEmail(user) : t.labels.freePlan}</span>
              <div className="account-actions">
                <LanguageSwitcher
                  label={t.labels.language}
                  locale={locale}
                  setLocale={setLocale}
                />
                {user ? (
                  <button
                    aria-label={t.labels.signOut}
                    className="icon-button"
                    title={t.labels.signOut}
                    type="button"
                    onClick={() => pb.authStore.clear()}
                  >
                    <Icon name="logOut" />
                  </button>
                ) : (
                  <button
                    className="icon-text-button"
                    type="button"
                    onClick={() => openAuthPrompt(undefined, true)}
                  >
                    <Icon name="user" />
                    <span>{t.auth.createAccount}</span>
                  </button>
                )}
              </div>
              {!user ? <p>{t.auth.cloudPrompt}</p> : null}
            </div>
          </>
        ) : null}
      </aside>

      <section className="canvas-column">
        {activeDrawing ? (
          <>
            <div className="canvas-toolbar">
              <input
                aria-label={t.labels.title}
                defaultValue={activeDrawing.title}
                key={activeDrawing.id}
                placeholder={t.terms.untitledDrawing}
                onBlur={(event) =>
                  void renameDrawing(activeDrawing, event.currentTarget.value)
                }
              />
              <div className="toolbar-actions">
                {!isCloudAccount ? (
                  <button
                    aria-label={t.labels.cloudSave}
                    className="icon-text-button primary"
                    title={t.labels.cloudSave}
                    type="button"
                    onClick={() =>
                      openAuthPrompt(t.status.accountRequiredForCloud, true)
                    }
                  >
                    <Icon name="cloud" />
                    <span>{t.labels.cloudSave}</span>
                  </button>
                ) : null}
                <span>{status}</span>
              </div>
            </div>
            <DrawingEditor
              key={activeDrawing.id}
              drawing={activeDrawing}
              locale={locale}
              scheduleSave={scheduleSave}
            />
          </>
        ) : (
          <div className="empty-state">
            <h2>{t.status.noDrawings}</h2>
            <button className="icon-text-button" type="button" onClick={createDrawing}>
              <Icon name="plus" />
              <span>{t.labels.createDrawing}</span>
            </button>
          </div>
        )}
      </section>
      {authPromptOpen ? (
        <AuthPanel
          locale={locale}
          pb={pb}
          setLocale={setLocale}
          onClose={closeAuthPrompt}
        />
      ) : null}
    </main>
  );
}

function DrawingEditor({
  drawing,
  locale,
  scheduleSave,
}: {
  drawing: Drawing;
  locale: Locale;
  scheduleSave: (scene: SceneData) => void;
}) {
  const [module, setModule] = useState<ExcalidrawModule | null>(null);
  const [loadError, setLoadError] = useState("");
  const t = translations[locale];

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
            error instanceof Error ? error.message : t.status.canvasLoadError,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t.status.canvasLoadError]);

  if (loadError) {
    return (
      <div className="empty-state">
        <h2>{t.status.canvasLoadError}</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="empty-state">
        <h2>{t.status.canvasLoading}</h2>
      </div>
    );
  }

  const { Excalidraw, serializeAsJSON } = module;

  return (
    <div className="canvas-frame">
      <Excalidraw
        initialData={drawing.scene}
        langCode={locale === "es" ? "es-ES" : "en"}
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

function AuthPanel({
  locale,
  onClose,
  pb,
  setLocale,
}: {
  locale: Locale;
  onClose?: () => void;
  pb: PocketBase;
  setLocale: (locale: Locale) => void;
}) {
  const t = translations[locale];
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [otpId, setOtpId] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setStatus(t.auth.emailRequired);
      return;
    }

    setIsSubmitting(true);
    setStatus(t.auth.working);

    try {
      let result;

      try {
        result = await pb.collection("users").requestOTP(normalizedEmail);
      } catch {
        const password = generateRandomPassword();
        await pb.collection("users").create({
          email: normalizedEmail,
          password,
          passwordConfirm: password,
        });
        result = await pb.collection("users").requestOTP(normalizedEmail);
      }

      setOtpId(result.otpId);
      setCode("");
      setStep("code");
      setStatus(`${t.auth.codeSentTo} ${normalizedEmail}`);
    } catch {
      setStatus(t.auth.sendError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    const trimmedCode = code.trim();

    if (!trimmedCode) {
      setStatus(t.auth.codeRequired);
      return;
    }

    setIsSubmitting(true);
    setStatus(t.auth.working);

    try {
      await pb.collection("users").authWithOTP(otpId, trimmedCode);
      setStatus(t.auth.signedIn);
    } catch {
      setStatus(t.auth.invalidCode);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={onClose ? "auth-shell auth-modal" : "auth-shell"}>
      <section className="auth-panel">
        <div className="auth-header">
          <div>
            <p className="eyebrow">{t.appName}</p>
            <h1>{t.auth.signIn}</h1>
          </div>
          <div className="auth-header-actions">
            {!onClose ? (
              <LanguageSwitcher
                label={t.labels.language}
                locale={locale}
                setLocale={setLocale}
              />
            ) : null}
            {onClose ? (
              <button
                aria-label={t.labels.close}
                className="icon-button"
                title={t.labels.close}
                type="button"
                onClick={onClose}
              >
                <Icon name="x" />
              </button>
            ) : null}
          </div>
        </div>
        {step === "email" ? (
          <>
            <p className="auth-description">{t.auth.cloudPrompt}</p>
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void sendCode();
                }
              }}
              placeholder={t.auth.email}
              type="email"
              value={email}
            />
            <button disabled={isSubmitting} type="button" onClick={() => void sendCode()}>
              {isSubmitting ? t.auth.working : t.auth.sendCode}
            </button>
          </>
        ) : (
          <>
            <p className="auth-description">{`${t.auth.codeSentTo} ${email.trim().toLowerCase()}`}</p>
            <input
              autoComplete="one-time-code"
              autoFocus
              inputMode="numeric"
              onChange={(event) => setCode(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void verifyCode();
                }
              }}
              placeholder={t.auth.code}
              type="text"
              value={code}
            />
            <button disabled={isSubmitting} type="button" onClick={() => void verifyCode()}>
              {isSubmitting ? t.auth.working : t.auth.signIn}
            </button>
            <button
              className="text-button"
              disabled={isSubmitting}
              type="button"
              onClick={() => void sendCode()}
            >
              {t.auth.resendCode}
            </button>
            <button
              className="text-button"
              disabled={isSubmitting}
              type="button"
              onClick={() => {
                setStep("email");
                setOtpId("");
                setCode("");
                setStatus("");
              }}
            >
              {t.auth.changeEmail}
            </button>
          </>
        )}
        {status ? <p className="auth-status">{status}</p> : null}
      </section>
    </div>
  );
}

function LanguageSwitcher({
  label,
  locale,
  setLocale,
}: {
  label: string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}) {
  return (
    <div aria-label={label} className="language-switcher" role="group">
      <button
        aria-pressed={locale === "es"}
        className={locale === "es" ? "active" : ""}
        type="button"
        onClick={() => setLocale("es")}
      >
        ES
      </button>
      <button
        aria-pressed={locale === "en"}
        className={locale === "en" ? "active" : ""}
        type="button"
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string[]> = {
    chevronLeft: ["M15 18l-6-6 6-6"],
    chevronRight: ["M9 18l6-6-6-6"],
    cloud: [
      "M17.5 19H8a5 5 0 1 1 1.1-9.88A6 6 0 0 1 20.5 12 3.5 3.5 0 0 1 17.5 19z",
      "M12 13v6",
      "M9.5 15.5 12 13l2.5 2.5",
    ],
    copy: [
      "M8 8h10v10H8z",
      "M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    ],
    logOut: [
      "M10 17l5-5-5-5",
      "M15 12H3",
      "M21 19V5a2 2 0 0 0-2-2h-5",
      "M14 21h5a2 2 0 0 0 2-2",
    ],
    menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
    plus: ["M12 5v14", "M5 12h14"],
    trash: [
      "M3 6h18",
      "M8 6V4h8v2",
      "M6 6l1 15h10l1-15",
      "M10 11v6",
      "M14 11v6",
    ],
    user: [
      "M20 21a8 8 0 0 0-16 0",
      "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    ],
    x: ["M18 6 6 18", "M6 6l12 12"],
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      {paths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
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
