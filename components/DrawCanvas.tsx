"use client";

import PocketBaseClient from "pocketbase";
import { createPortal } from "react-dom";
import type PocketBase from "pocketbase";
import type { AuthModel } from "pocketbase";
import type { ComponentType } from "react";
import type { Collaborator, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeScenes, sceneFingerprint } from "@draw/scene-sync";
import { createLaserSender } from "../src/laser-channel";
import { createDraftImporter, draftImportId, hasDraftContent, loadAccountLibrary, selectDrawingId } from "../src/drawing-session";

type Locale = "es" | "en";
type ShareMode = "restricted" | "view" | "edit";
type DrawingAccess = "owner" | "view" | "edit";
type IconName =
  | "barChart"
  | "chevronLeft"
  | "chevronRight"
  | "cloud"
  | "copy"
  | "logOut"
  | "menu"
  | "plus"
  | "share"
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
  owner: string;
  title: string;
  scene: SceneData;
  share_mode: ShareMode;
  share_token: string;
  created: string;
  updated: string;
};

type AdminUser = {
  id: string;
  email: string;
  verified?: boolean;
  created: string;
  updated: string;
};

type AdminDrawing = {
  id: string;
  title: string;
  owner: string;
  created: string;
  updated: string;
};

type DrawingLimitRecord = {
  id: string;
  owner: string;
  maxDrawings: number;
  created: string;
  updated: string;
};

type DrawSetting = {
  id: string;
  key: string;
  value: number;
  created: string;
  updated: string;
};

type AdminUserRow = AdminUser & {
  drawingLimit: string;
  drawingLimitRecordId: string;
  drawingCount: number;
  lastDrawingAt: string;
};

type SharedDrawingLink = {
  drawingId: string;
  token: string;
};

type ExcalidrawModule = {
  Excalidraw: ComponentType<{
    initialData: SceneData;
    langCode?: string;
    onChange?: (elements: unknown[], appState: unknown, files: unknown) => void;
    UIOptions: Record<string, unknown>;
    viewModeEnabled?: boolean;
    renderTopRightUI?: (isMobile: boolean, appState: ReturnType<EditorAPI["getAppState"]>) => React.ReactNode;
    excalidrawAPI?: (api: EditorAPI) => void;
    isCollaborating?: boolean;
    onPointerUpdate?: (event: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => void;
  }>;
  serializeAsJSON: (
    elements: unknown[],
    appState: unknown,
    files: unknown,
    localAppState: "local" | "database",
  ) => string;
  reconcileElements: typeof import("@excalidraw/excalidraw")["reconcileElements"];
  CaptureUpdateAction: { NEVER: "NEVER" };
};

type EditorAPI = ExcalidrawImperativeAPI;

const pocketBaseUrl =
  import.meta.env.VITE_POCKETBASE_URL ?? "https://draw-db.raulzarza.com";
const adminEmails = String(
  import.meta.env.VITE_ADMIN_EMAILS ?? "raulzarza.dev@gmail.com",
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const localDrawingId = "local-free-drawing";
const localDrawingStorageKey = "draw-local-drawing";
const defaultRegisteredDrawingLimit = 3;
const drawingLimitSettingKey = "defaultRegisteredDrawingLimit";

const titleForStorage = (title: string, fallback: string) =>
  title.trim() || fallback;

const normalizeDrawingLimit = (value: unknown, fallback = defaultRegisteredDrawingLimit) => {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue)) {
    return fallback;
  }

  return Math.max(1, Math.min(999, Math.trunc(nextValue)));
};

const emptyLimitValue = (value: string) => value.trim() === "";

const getDrawingLimitForUser = async (pb: PocketBase, userId: string) => {
  const [settings, userLimits] = await Promise.all([
    pb.collection("draw_settings").getFullList<DrawSetting>({
      filter: `key = "${drawingLimitSettingKey}"`,
      fields: "id,key,value",
      requestKey: null,
    }),
    pb.collection("drawing_limits").getFullList<DrawingLimitRecord>({
      filter: `owner = "${userId}"`,
      fields: "id,owner,maxDrawings",
      requestKey: null,
    }),
  ]);

  const defaultLimit = normalizeDrawingLimit(settings[0]?.value);
  return normalizeDrawingLimit(userLimits[0]?.maxDrawings, defaultLimit);
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

const createLocalDrawing = (title: string): Drawing => {
  const now = new Date().toISOString();

  return {
    id: localDrawingId,
    owner: "",
    title,
    scene: emptyScene(),
    share_mode: "restricted",
    share_token: "",
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

const normalizeDrawing = (drawing: Drawing): Drawing => ({
  ...drawing,
  owner: drawing.owner ?? "",
  share_mode: drawing.share_mode ?? "restricted",
  share_token: drawing.share_token ?? "",
});

const readSharedDrawingLink = (): SharedDrawingLink | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const drawingId = params.get("drawing")?.trim() ?? "";
  const token = params.get("share")?.trim() ?? "";

  return drawingId && token ? { drawingId, token } : null;
};

const createShareToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const buildShareUrl = (drawingId: string, token: string) => {
  const url = new URL(window.location.origin);
  url.searchParams.set("drawing", drawingId);
  url.searchParams.set("share", token);
  return url.toString();
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
    return isDrawing(parsed)
      ? normalizeDrawing({ ...parsed, id: localDrawingId })
      : createLocalDrawing(title);
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
      accessTitle: "Crear cuenta o iniciar sesión",
      signIn: "Iniciar sesión",
      signedIn: "Sesion iniciada",
      working: "Procesando...",
    },
    labels: {
      admin: "Admin",
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
      signInToEdit: "Iniciar sesión para editar",
      reloadDrawings: "Volver a cargar pizarras",
      share: "Compartir",
      title: "Titulo del dibujo",
    },
    admin: {
      defaultDrawingLimit: "Max pizarras por usuario registrado",
      drawings: "Pizarras",
      lastActivity: "Ultima actividad",
      limit: "Limite",
      noUsers: "Aun no hay usuarios",
      open: "Panel admin",
      refresh: "Actualizar",
      title: "Panel admin",
      totalDrawings: "Pizarras totales",
      totalUsers: "Usuarios",
      unknown: "Sin actividad",
      user: "Usuario",
      usersError:
        "No pude cargar usuarios. Revisa las reglas admin de PocketBase.",
    },
    status: {
      accountRequiredForCloud:
        "Crea una cuenta para guardar en la nube y tener mas pizarras.",
      accountRequiredForEditing: "Para editar este dibujo compartido, primero debes crear una cuenta o iniciar sesión.",
      accountRequiredForSharing: "Si deseas compartir un dibujo, primero debes crear una cuenta o iniciar sesión.",
      accountRequiredForMore: "Crea una cuenta para crear mas pizarras.",
      canvasLoadError: "No se pudo cargar el canvas",
      canvasLoading: "Cargando canvas...",
      couldNotCreate: "No se pudo crear el dibujo",
      couldNotDelete: "No se pudo eliminar",
      couldNotDuplicate: "No se pudo duplicar",
      couldNotLoad: "No se pudieron cargar los dibujos",
      couldNotRename: "No se pudo renombrar",
      couldNotSave: "No se pudo guardar",
      couldNotShare: "No se pudo actualizar el acceso. Intenta de nuevo.",
      createFirst: "Crea tu primer dibujo",
      created: "Creado",
      creating: "Creando...",
      deleted: "Eliminado",
      duplicated: "Duplicado",
      couldNotLoadLimit: "Tus pizarras están disponibles, pero no se pudo consultar el límite. Reconecta para crear más.",
      drawingLimitReached: "Límite alcanzado. Suscríbete para crear más pizarras.",
      laserUnavailable: "Puntero láser sin conexión. No afecta al guardado.",
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
    share: {
      access: "Acceso general",
      copyLink: "Copiar enlace",
      copied: "Enlace copiado",
      description: "Elige qué puede hacer cualquier persona que tenga este enlace.",
      edit: "Puede editar",
      editDescription: "Puede cambiar el título y el contenido del dibujo.",
      linkLabel: "Enlace para compartir",
      readOnly: "Solo lectura",
      restricted: "Restringido",
      restrictedDescription: "Solo tú puedes abrir este dibujo.",
      title: "Compartir dibujo",
      view: "Puede ver",
      viewDescription: "Puede abrir el dibujo, pero no modificarlo.",
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
      accessTitle: "Create an account or sign in",
      signIn: "Sign in",
      signedIn: "Signed in",
      working: "Working...",
    },
    labels: {
      admin: "Admin",
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
      signInToEdit: "Sign in to edit",
      reloadDrawings: "Reload saved boards",
      share: "Share",
      title: "Drawing title",
    },
    admin: {
      defaultDrawingLimit: "Max boards per registered user",
      drawings: "Boards",
      lastActivity: "Last activity",
      limit: "Limit",
      noUsers: "No users yet",
      open: "Admin panel",
      refresh: "Refresh",
      title: "Admin panel",
      totalDrawings: "Total boards",
      totalUsers: "Users",
      unknown: "No activity",
      user: "User",
      usersError:
        "Could not load users. Check the PocketBase admin rules.",
    },
    status: {
      accountRequiredForCloud:
        "Create an account to save to the cloud and keep more boards.",
      accountRequiredForEditing: "To edit this shared drawing, first create an account or sign in.",
      accountRequiredForSharing: "To share a drawing, first create an account or sign in.",
      accountRequiredForMore: "Create an account to create more boards.",
      canvasLoadError: "Canvas could not load",
      canvasLoading: "Loading canvas...",
      couldNotCreate: "Could not create drawing",
      couldNotDelete: "Could not delete",
      couldNotDuplicate: "Could not duplicate",
      couldNotLoad: "Could not load drawings",
      couldNotRename: "Could not rename",
      couldNotSave: "Could not save",
      couldNotShare: "Could not update access. Try again.",
      createFirst: "Create your first drawing",
      created: "Created",
      creating: "Creating...",
      deleted: "Deleted",
      duplicated: "Duplicated",
      couldNotLoadLimit: "Your boards are available, but the limit could not be loaded. Reconnect to create more.",
      drawingLimitReached: "Limit reached. Subscribe to create more boards.",
      laserUnavailable: "Laser pointer offline. Saving is unaffected.",
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
    share: {
      access: "General access",
      copyLink: "Copy link",
      copied: "Link copied",
      description: "Choose what anyone with this link can do.",
      edit: "Can edit",
      editDescription: "Can change the title and drawing contents.",
      linkLabel: "Share link",
      readOnly: "Read only",
      restricted: "Restricted",
      restrictedDescription: "Only you can open this drawing.",
      title: "Share drawing",
      view: "Can view",
      viewDescription: "Can open the drawing but cannot change it.",
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
  const [isMobile, setIsMobile] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<string>(t.status.ready);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [authPromptMessage, setAuthPromptMessage] = useState<string>();
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [drawingLimit, setDrawingLimit] = useState(0);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Drawing | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScene = useRef(new Map<string, SceneData>());
  const savingScene = useRef(false);
  const flushSceneRef = useRef<() => void>(() => {});
  const localDraftToImport = useRef<Drawing | null>(null);
  const userId = user?.id ?? null;
  const currentAccount = useRef(userId);
  const libraryVersion = useRef(0);
  const importDraft = useMemo(() => createDraftImporter<Drawing>(), []);
  const isCloudAccount = !!user;
  const isAdmin = adminEmails.includes(getEmail(user).toLowerCase());
  const sharedLink = useMemo(readSharedDrawingLink, []);

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
  const activeAccess: DrawingAccess = activeDrawing?.id === localDrawingId
    ? "owner"
    : activeDrawing?.owner && activeDrawing.owner === user?.id
    ? "owner"
    : userId && activeDrawing?.share_mode === "edit"
      ? "edit"
      : "view";
  const canEditActiveDrawing = activeAccess === "owner" || activeAccess === "edit";

  const openAuthPrompt = useCallback(
    (message?: string, importCurrentDrawing = false) => {
      if (importCurrentDrawing && !user && activeDrawing) {
        const draft = { ...activeDrawing, scene: latestScene.current.get(activeDrawing.id) || activeDrawing.scene };
        localDraftToImport.current = hasDraftContent(draft) ? draft : null;
      }

      setAuthPromptMessage(message);
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
    if (!userId) return;
    const version = ++libraryVersion.current;
    const isCurrent = () => version === libraryVersion.current && currentAccount.current === userId;
    setStatus(t.status.loading);
    try {
      const library = await loadAccountLibrary<Drawing>({
        loadDrawings: () => pb.collection("drawings").getFullList<Drawing>({
          filter: `owner = "${userId}"`, sort: "-updated", requestKey: null,
          fields: "id,owner,title,scene,share_mode,share_token,created,updated",
        }),
        loadLimit: () => getDrawingLimitForUser(pb, userId),
        isCurrent,
        publish: items => {
          const normalized = items.map(normalizeDrawing);
          setDrawings(current => normalized.map(drawing => {
            const local = current.find(item => item.id === drawing.id);
            const pending = latestScene.current.get(drawing.id);
            return local ? { ...drawing, scene: mergeScenes(
              mergeScenes(local.scene, drawing.scene), pending || drawing.scene,
            ) } : drawing;
          }));
          setActiveId(current => selectDrawingId(current, normalized));
          setStatus(items.length ? t.status.ready : t.status.createFirst);
        },
      });
      if (!library) return;
      const { drawings: existing, limit } = library;
      // Unknown limits block creation, but never hide the user's saved library.
      setDrawingLimit(limit ?? 0);
      if (limit === null) { setStatus(t.status.couldNotLoadLimit); return; }
      if (!drawingToImport || !hasDraftContent(drawingToImport)) return;
      const id = await draftImportId(userId, drawingToImport.created);
      if (!isCurrent()) return;
      const alreadyImported = existing.find(drawing => drawing.id === id);
      if (!alreadyImported && existing.length >= limit) {
        setStatus(t.status.drawingLimitReached);
        return;
      }
      const imported = alreadyImported || await importDraft(drawingToImport, userId, {
        create: id => pb.collection("drawings").create<Drawing>({
          id, owner: userId,
          title: titleForStorage(drawingToImport.title, t.terms.untitledDrawing),
          scene: drawingToImport.scene,
        }, { requestKey: null }),
        find: id => pb.collection("drawings").getOne<Drawing>(id, { requestKey: null }),
        isCurrent,
      });
      if (!isCurrent() || !imported) return;
      localDraftToImport.current = null;
      // Retire the guest copy only after a confirmed import; keep it on failure.
      saveLocalDrawing(createLocalDrawing(""));
      setDrawings(items => [normalizeDrawing(imported), ...items.filter(item => item.id !== imported.id)]);
      setActiveId(imported.id);
      setStatus(t.status.saved);
    } catch (error) {
      if (isCurrent()) setStatus(error instanceof Error ? error.message : t.status.couldNotLoad);
    }
  }, [pb, userId, importDraft, t]);

  const loadSharedDrawing = useCallback(async (link: SharedDrawingLink) => {
    setStatus(t.status.loading);

    try {
      const drawing = await pb.collection("drawings").getOne<Drawing>(link.drawingId, {
        fields: "id,owner,title,scene,share_mode,share_token,created,updated",
        query: { share_token: link.token },
      });
      setDrawings([normalizeDrawing(drawing)]);
      setActiveId(drawing.id);
      setStatus(t.status.ready);
    } catch (error) {
      setDrawings([]);
      setActiveId(null);
      setStatus(error instanceof Error ? error.message : t.status.couldNotLoad);
    }
  }, [pb, t.status.couldNotLoad, t.status.loading, t.status.ready]);

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(
      () => {
        const nextUser = pb.authStore.record;
        const nextAccount = nextUser?.id ?? null;
        if (currentAccount.current !== nextAccount) {
          currentAccount.current = nextAccount;
          libraryVersion.current++;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = null;
          latestScene.current.clear();
          setDrawings([]);
          setActiveId(null);
          setDrawingLimit(0);
        }
        setUser(nextUser);
      },
      true,
    );

    setAuthReady(true);
    return unsubscribe;
  }, [pb]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 700px)");
    const syncSidebar = () => {
      setIsMobile(mediaQuery.matches);
      setSidebarCollapsed(true);
    };

    syncSidebar();
    mediaQuery.addEventListener("change", syncSidebar);
    return () => mediaQuery.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (sharedLink) {
      if (userId) setAuthPromptOpen(false);
      void loadSharedDrawing(sharedLink);
      return;
    }

    if (user) {
      setAuthPromptOpen(false);
      void loadDrawings(localDraftToImport.current);
      const refresh = () => {
        if (document.visibilityState === "visible") void loadDrawings(localDraftToImport.current);
      };
      window.addEventListener("online", refresh);
      document.addEventListener("visibilitychange", refresh);
      return () => {
        libraryVersion.current++;
        window.removeEventListener("online", refresh);
        document.removeEventListener("visibilitychange", refresh);
      };
    }
    loadFreeDrawing();
  }, [loadDrawings, loadFreeDrawing, loadSharedDrawing, sharedLink, userId]);

  useEffect(() => {
    if (!activeId || activeId === localDrawingId || (!user && !sharedLink)) return;
    let disposed = false;
    const options = sharedLink ? { query: { share_token: sharedLink.token } } : {};
    const applyRemote = (remote: Drawing) => {
      if (disposed) return;
      const pending = latestScene.current.get(remote.id);
      if (remote.owner !== user?.id && remote.share_mode !== "edit") latestScene.current.delete(remote.id);
      else if (pending) latestScene.current.set(remote.id, mergeScenes(pending, remote.scene));
      setDrawings(items => items.map(item => item.id === remote.id
        ? { ...item, ...normalizeDrawing(remote), scene: mergeScenes(
            pending || item.scene, remote.scene,
          ) }
        : item));
    };
    const removeRemote = () => {
      if (disposed) return;
      latestScene.current.delete(activeId);
      setDrawings(items => items.filter(item => item.id !== activeId));
      setActiveId(null);
    };
    const refresh = async () => {
      try {
        applyRemote(await pb.collection("drawings").getOne<Drawing>(activeId, {
          ...options, requestKey: null,
        }));
      } catch (error) {
        if (error instanceof Error && "status" in error && [403, 404].includes(Number(error.status))) removeRemote();
      }
    };
    const subscriptions: Array<() => Promise<void>> = [];
    const keepSubscription = (stop: () => Promise<void>) => {
      if (disposed) void stop(); else subscriptions.push(stop);
    };
    void pb.collection("drawings").subscribe<Drawing>(activeId, event => {
      if (event.action === "delete") removeRemote(); else applyRemote(event.record);
    }, options).then(stop => {
      keepSubscription(stop);
      // Close the gap between initial load and establishing the subscription.
      if (!disposed) void refresh();
    }).catch(() => { if (!disposed) void refresh(); });
    void pb.realtime.subscribe("PB_CONNECT", () => void refresh()).then(keepSubscription).catch(() => {});
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    // Revalidate shared access even when revocation makes further SSE events
    // inaccessible; this also recovers updates if the connection was interrupted.
    const accessTimer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, sharedLink ? 5000 : 15000);
    return () => {
      disposed = true;
      clearInterval(accessTimer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      subscriptions.forEach(stop => void stop());
    };
  }, [activeId, pb, sharedLink, user?.id]);

  useEffect(() => {
    if (!isMobile || sidebarCollapsed || authPromptOpen || adminPanelOpen || sharePanelOpen || pendingDelete) return;
    const panel = sidebarRef.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarCollapsed(true);
      if (event.key !== "Tab" || !panel) return;
      const controls = panel.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mobileMenuRef.current?.focus();
    };
  }, [isMobile, sidebarCollapsed, authPromptOpen, adminPanelOpen, sharePanelOpen, pendingDelete]);

  // Lock horizontal swipes only after intent is clear, preserving list scrolling.
  useEffect(() => {
    const panel = sidebarRef.current;
    if (!panel || !isMobile || sidebarCollapsed) return;
    let gesture: { x: number; y: number; axis: "pending" | "horizontal" | "vertical"; offset: number } | null = null;
    let suppressClick = false;
    const reset = () => {
      gesture = null;
      panel.style.removeProperty("transform");
    };
    const start = (event: TouchEvent) => {
      suppressClick = false;
      if (event.touches.length !== 1) { reset(); return; }
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea")) return;
      const touch = event.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, axis: "pending", offset: 0 };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) { reset(); return; }
      const dx = event.touches[0].clientX - gesture.x;
      const dy = event.touches[0].clientY - gesture.y;
      if (gesture.axis === "pending") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        gesture.axis = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "horizontal" : "vertical";
      }
      if (gesture.axis !== "horizontal") return;
      if (event.cancelable) event.preventDefault();
      suppressClick = true;
      gesture.offset = Math.min(0, dx);
      panel.style.transform = `translateX(${gesture.offset}px)`;
    };
    const end = () => {
      const close = gesture?.axis === "horizontal" && -gesture.offset >= Math.min(80, panel.clientWidth * 0.25);
      reset();
      if (close) setSidebarCollapsed(true);
    };
    const cancel = () => { reset(); };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    panel.addEventListener("touchstart", start, { passive: true });
    panel.addEventListener("touchmove", move, { passive: false });
    panel.addEventListener("touchend", end);
    panel.addEventListener("touchcancel", cancel);
    panel.addEventListener("click", click, true);
    return () => {
      reset();
      panel.removeEventListener("touchstart", start);
      panel.removeEventListener("touchmove", move);
      panel.removeEventListener("touchend", end);
      panel.removeEventListener("touchcancel", cancel);
      panel.removeEventListener("click", click, true);
    };
  }, [isMobile, sidebarCollapsed]);

  const createDrawing = useCallback(async () => {
    if (!user) {
      openAuthPrompt(t.status.accountRequiredForMore, true);
      return;
    }

    if (!drawingLimit) { setStatus(t.status.couldNotLoadLimit); return; }
    if (drawings.length >= drawingLimit) {
      setStatus(t.status.drawingLimitReached);
      return;
    }

    setStatus(t.status.creating);

    try {
      const drawing = await pb.collection("drawings").create<Drawing>({
        owner: user.id,
        title: t.terms.untitledDrawing,
        scene: emptyScene(),
      });

      setDrawings((items) => [normalizeDrawing(drawing), ...items]);
      setActiveId(drawing.id);
      if (window.matchMedia("(max-width: 700px)").matches) setSidebarCollapsed(true);
      setStatus(t.status.created);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.status.couldNotCreate);
    }
  }, [
    pb,
    t.status.couldNotCreate,
    t.status.couldNotLoadLimit,
    t.status.created,
    t.status.creating,
    t.status.drawingLimitReached,
    t.status.accountRequiredForMore,
    t.terms.untitledDrawing,
    openAuthPrompt,
    drawingLimit,
    drawings.length,
    user,
  ]);

  const renameDrawing = useCallback(
    async (drawing: Drawing, title: string) => {
      if (!canEditActiveDrawing) {
        return;
      }
      const nextTitle = titleForStorage(title, t.terms.untitledDrawing);
      const nextDrawing = { ...drawing, title: nextTitle, updated: new Date().toISOString() };

      setDrawings((items) =>
        items.map((item) =>
          item.id === drawing.id ? nextDrawing : item,
        ),
      );

      if (!user && !sharedLink) {
        localDraftToImport.current = hasDraftContent(nextDrawing) ? nextDrawing : null;
        saveLocalDrawing(nextDrawing);
        setStatus(t.status.savedLocally);
        return;
      }

      try {
        await pb.collection("drawings").update(
          drawing.id,
          { title: nextTitle },
          sharedLink ? { query: { share_token: sharedLink.token } } : undefined,
        );
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
      t.terms.untitledDrawing,
      user,
      canEditActiveDrawing,
      sharedLink,
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
        return true;
      }

      try {
        await pb.collection("drawings").delete(drawing.id);
        setDrawings((items) => {
          const next = items.filter((item) => item.id !== drawing.id);
          setActiveId(next[0]?.id ?? null);
          return next;
        });
        setStatus(t.status.deleted);
        return true;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t.status.couldNotDelete);
        throw error;
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

      if (!drawingLimit) { setStatus(t.status.couldNotLoadLimit); return; }
      if (drawings.length >= drawingLimit) {
        setStatus(t.status.drawingLimitReached);
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

        setDrawings((items) => [normalizeDrawing(duplicate), ...items]);
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
      t.status.couldNotLoadLimit,
      t.status.duplicated,
      t.status.drawingLimitReached,
      t.terms.copySuffix,
      drawingLimit,
      drawings.length,
      openAuthPrompt,
      user,
    ],
  );

  const saveScene = useCallback(
    async (drawingId: string, scene: SceneData) => {
      if (drawingId === localDrawingId) {
        const draft = { ...loadLocalDrawing(""), scene, updated: new Date().toISOString() };
        saveLocalDrawing(draft);
        localDraftToImport.current = hasDraftContent(draft) ? draft : null;
        setDrawings(items => items.map(item => item.id === drawingId ? draft : item));
        setStatus(t.status.savedLocally);
        return true;
      }

      if ((sharedLink && !currentAccount.current) || currentAccount.current !== (user?.id ?? null)) return true;
      setStatus(t.status.saving);

      try {
        const updated = await pb
          .collection("drawings")
          .update<Pick<Drawing, "id" | "scene" | "updated">>(drawingId, { scene }, {
            fields: "id,scene,updated",
            requestKey: null,
            query: { scene_merge: "1", ...(sharedLink ? { share_token: sharedLink.token } : {}) },
          });

        if (currentAccount.current !== (user?.id ?? null)) return true;
        setDrawings((items) =>
          items.map((item) =>
            item.id === drawingId ? { ...item,
              scene: mergeScenes(
                mergeScenes(item.scene, updated.scene), latestScene.current.get(drawingId) || scene,
              ),
              updated: updated.updated } : item,
          ),
        );
        setStatus(t.status.saved);
        return true;
      } catch (error) {
        if (currentAccount.current !== (user?.id ?? null)) return true;
        setStatus(error instanceof Error ? error.message : t.status.couldNotSave);
        if (error instanceof Error && "status" in error && [403, 404].includes(Number(error.status))) {
          latestScene.current.delete(drawingId);
          // An inaccessible/deleted drawing must not be retried indefinitely.
          return true;
        }
        return false;
      }
    },
    [
      pb,
      t.status.couldNotSave,
      t.status.saved,
      t.status.savedLocally,
      t.status.saving,
      user,
      sharedLink,
    ],
  );

  const updateSharing = useCallback(async (mode: ShareMode) => {
    if (!userId || !activeDrawing || activeAccess !== "owner") {
      return;
    }

    const token = mode === "restricted"
      ? ""
      : activeDrawing.share_token || createShareToken();

    try {
      const updated = await pb.collection("drawings").update<Drawing>(activeDrawing.id, {
        share_mode: mode,
        share_token: token,
      }, {
        fields: "id,owner,title,scene,share_mode,share_token,created,updated",
      });
      setDrawings((items) => items.map((item) => (
        item.id === activeDrawing.id ? normalizeDrawing(updated) : item
      )));
      setStatus(t.status.saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.status.couldNotShare);
      throw error;
    }
  }, [activeAccess, activeDrawing, pb, t.status.couldNotShare, t.status.saved, userId]);

  const flushScene = useCallback(async () => {
    if (savingScene.current) return;
    const pending = latestScene.current.entries().next().value;
    if (!pending) return;
    const [drawingId, scene] = pending;
    latestScene.current.delete(drawingId);
    savingScene.current = true;
    const account = currentAccount.current;
    const saved = await saveScene(drawingId, scene);
    savingScene.current = false;
    if (account !== currentAccount.current) { flushSceneRef.current(); return; }
    if (!saved) latestScene.current.set(drawingId,
      mergeScenes(scene, latestScene.current.get(drawingId) || scene));
    if (saved && latestScene.current.size && !saveTimer.current) {
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        flushSceneRef.current();
      }, 250);
    }
  }, [saveScene]);
  flushSceneRef.current = () => { void flushScene(); };

  const scheduleSave = useCallback(
    (scene: SceneData) => {
      if (!activeDrawing) {
        return;
      }

      if (activeDrawing.id === localDrawingId) {
        const draft = { ...activeDrawing, scene, updated: new Date().toISOString() };
        saveLocalDrawing(draft);
        localDraftToImport.current = hasDraftContent(draft) ? draft : null;
        setDrawings(items => items.map(item => item.id === localDrawingId ? draft : item));
        setStatus(t.status.savedLocally);
        return;
      }
      latestScene.current.set(activeDrawing.id, scene);
      if (!saveTimer.current) saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        flushSceneRef.current();
      }, 250);
    },
    [activeDrawing, t.status.savedLocally],
  );

  useEffect(() => {
    const retry = () => flushSceneRef.current();
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("online", retry);
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
      {isMobile && !sidebarCollapsed ? (
        <button className="sidebar-backdrop" aria-label={t.labels.hideDrawings}
          tabIndex={-1} onClick={() => setSidebarCollapsed(true)} />
      ) : null}
      <aside className="draw-sidebar" id="drawing-navigation" ref={sidebarRef}
        aria-label={t.terms.myDrawings}
        role={isMobile && !sidebarCollapsed ? "dialog" : undefined}
        aria-modal={isMobile && !sidebarCollapsed ? true : undefined}>
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
            <h1>{sharedLink ? t.share.title : t.terms.myDrawings}</h1>
          </div>
          {!sharedLink ? (
            <button
              aria-label={t.labels.createDrawing}
              className="icon-button"
              title={t.labels.createDrawing}
              type="button"
              onClick={createDrawing}
            >
              <Icon name="plus" />
            </button>
          ) : null}
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
                    onClick={() => {
                      setActiveId(drawing.id);
                      if (isMobile) setSidebarCollapsed(true);
                    }}
                  >
                    <span className={drawing.title.trim() ? "" : "untitled"}>
                      {drawing.title.trim() || t.terms.untitledDrawing}
                    </span>
                    <small>{formatTime(drawing.updated, locale)}</small>
                  </button>
                  {activeAccess === "owner" && !sharedLink ? (
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
                      onClick={() => setPendingDelete(drawing)}
                    >
                      <Icon name="trash" />
                    </button>
                    </div>
                  ) : null}
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
                  <>
                    {isAdmin ? (
                      <button
                        aria-label={t.admin.open}
                        className="icon-button"
                        title={t.admin.open}
                        type="button"
                        onClick={() => setAdminPanelOpen(true)}
                      >
                        <Icon name="barChart" />
                      </button>
                    ) : null}
                    <button
                      aria-label={t.labels.signOut}
                      className="icon-button"
                      title={t.labels.signOut}
                      type="button"
                      onClick={() => pb.authStore.clear()}
                    >
                      <Icon name="logOut" />
                    </button>
                  </>
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
        ) : !isMobile ? (
          <>
            <nav className="drawing-rail" aria-label={t.terms.myDrawings}>
              {drawings.map((drawing) => (
                <button key={drawing.id} className={`icon-button rail-drawing ${drawing.id === activeId ? "active" : ""}`}
                  type="button" title={drawing.title.trim() || t.terms.untitledDrawing}
                  aria-label={drawing.title.trim() || t.terms.untitledDrawing}
                  aria-current={drawing.id === activeId ? "page" : undefined}
                  onClick={() => setActiveId(drawing.id)}>
                  <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4" />
                  </svg>
                </button>
              ))}
            </nav>
            <div className="rail-account">
              {isAdmin ? <button className="icon-button" type="button" title={t.admin.open}
                aria-label={t.admin.open} onClick={() => setAdminPanelOpen(true)}><Icon name="barChart" /></button> : null}
              <button className="icon-button" type="button" title={user ? getEmail(user) : t.auth.createAccount}
                aria-label={user ? getEmail(user) : t.auth.createAccount}
                onClick={() => user ? setSidebarCollapsed(false) : openAuthPrompt(undefined, true)}><Icon name="user" /></button>
            </div>
          </>
        ) : null}
      </aside>

      <section className="canvas-column" inert={isMobile && !sidebarCollapsed}>
        {!activeDrawing ? <div className="mobile-workspace-header">
          <button ref={mobileMenuRef} className="icon-button" type="button"
            aria-label={t.labels.showDrawings} aria-expanded={!sidebarCollapsed}
            aria-controls="drawing-navigation" onClick={() => setSidebarCollapsed(false)}>
            <Icon name="menu" />
          </button>
          <span><img src="/icons/draw.svg" width="24" height="24" alt="" />{t.appName}</span>
          {!sharedLink ? <button className="icon-button" type="button"
            aria-label={t.labels.createDrawing} title={t.labels.createDrawing}
            onClick={createDrawing}><Icon name="plus" /></button> : null}
        </div> : null}
        {activeDrawing ? (
          <>
            <div className="canvas-toolbar">
              <button ref={mobileMenuRef} className="icon-button mobile-toolbar-action" type="button"
                aria-label={t.labels.showDrawings} aria-expanded={!sidebarCollapsed}
                aria-controls="drawing-navigation" onClick={() => setSidebarCollapsed(false)}>
                <Icon name="menu" />
              </button>
              <div className="drawing-heading">
              <input
                aria-label={t.labels.title}
                defaultValue={activeDrawing.title}
                key={activeDrawing.id}
                placeholder={t.terms.untitledDrawing}
                readOnly={!canEditActiveDrawing}
                onBlur={(event) =>
                  void renameDrawing(activeDrawing, event.currentTarget.value)
                }
              />
              <span className="drawing-save-status" role="status">{status}</span>
              </div>
              <div className="toolbar-actions">
                {!sharedLink ? <button className="icon-button mobile-toolbar-action" type="button"
                  aria-label={t.labels.createDrawing} title={t.labels.createDrawing}
                  onClick={createDrawing}><Icon name="plus" /></button> : null}
                {sharedLink && !userId && activeDrawing.share_mode === "edit" ? (
                  <button className="icon-text-button primary" type="button"
                    aria-label={t.labels.signInToEdit} title={t.labels.signInToEdit}
                    onClick={() => openAuthPrompt(t.status.accountRequiredForEditing)}>
                    <Icon name="user" /><span>{t.labels.signInToEdit}</span>
                  </button>
                ) : null}
                {!isCloudAccount && !sharedLink ? (
                  <button
                    aria-label={t.labels.share}
                    className="icon-text-button primary"
                    title={t.labels.share}
                    type="button"
                    onClick={() =>
                      openAuthPrompt(t.status.accountRequiredForSharing, true)
                    }
                  >
                    <Icon name="share" />
                    <span>{t.labels.share}</span>
                  </button>
                ) : null}
                {isCloudAccount && activeAccess === "owner" ? (
                  <button
                    aria-label={t.labels.share}
                    title={t.labels.share}
                    className="icon-text-button"
                    type="button"
                    onClick={() => setSharePanelOpen(true)}
                  >
                    <Icon name="share" />
                    <span>{t.labels.share}</span>
                  </button>
                ) : sharedLink ? (
                  <span className="access-badge">
                    {activeAccess === "edit" ? t.share.edit : t.share.readOnly}
                  </span>
                ) : null}
              </div>
            </div>
            <DrawingEditor
              key={activeDrawing.id}
              drawing={activeDrawing}
              locale={locale}
              readOnly={!canEditActiveDrawing}
              scheduleSave={scheduleSave}
              pb={pb}
              sharedLink={sharedLink}
            />
          </>
        ) : (
          <div className="empty-state">
            <h2>{status === t.status.loading ? t.status.loading : t.status.noDrawings}</h2>
            <p className="library-status" role="status">{status}</p>
            {user && !sharedLink ? (
              <button type="button" onClick={() => void loadDrawings(localDraftToImport.current)}>
                {t.labels.reloadDrawings}
              </button>
            ) : null}
            <button className="icon-text-button" type="button" onClick={createDrawing}>
              <Icon name="plus" />
              <span>{t.labels.createDrawing}</span>
            </button>
          </div>
        )}
      </section>
      {pendingDelete ? <DeleteDrawingDialog drawing={pendingDelete} locale={locale}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => deleteDrawing(pendingDelete)} /> : null}
      {authPromptOpen ? (
        <AuthPanel
          locale={locale}
          pb={pb}
          setLocale={setLocale}
          onClose={closeAuthPrompt}
          message={authPromptMessage}
        />
      ) : null}
      {adminPanelOpen && isAdmin ? (
        <AdminPanel
          locale={locale}
          pb={pb}
          onClose={() => setAdminPanelOpen(false)}
        />
      ) : null}
      {sharePanelOpen && isCloudAccount && activeDrawing && activeAccess === "owner" ? (
        <SharePanel
          drawing={activeDrawing}
          locale={locale}
          onClose={() => setSharePanelOpen(false)}
          updateSharing={updateSharing}
        />
      ) : null}
    </main>
  );
}

function DrawingEditor({
  drawing,
  locale,
  readOnly,
  scheduleSave,
  pb,
  sharedLink,
}: {
  drawing: Drawing;
  locale: Locale;
  readOnly: boolean;
  scheduleSave: (scene: SceneData) => void;
  pb: PocketBase;
  sharedLink: SharedDrawingLink | null;
}) {
  const [module, setModule] = useState<ExcalidrawModule | null>(null);
  const [editorAPI, setEditorAPI] = useState<EditorAPI | null>(null);
  const lastFingerprint = useRef(sceneFingerprint(drawing.scene));
  const applyingRemote = useRef(false);
  const laserSessionId = useRef(crypto.randomUUID());
  const laserSend = useRef<(event: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => void>(() => {});
  const [loadError, setLoadError] = useState("");
  const [laserError, setLaserError] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const [lockMenuHost, setLockMenuHost] = useState<HTMLDivElement | null>(null);
  const [toolLocked, setToolLocked] = useState(true);

  // Excalidraw has no public slot for extra-tool menu items. Mount our
  // control beside its laser item and clean it up with the editor/menu.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !module || readOnly) return;
    let host: HTMLDivElement | null = null;
    const syncMenu = () => {
      const laser = frame.querySelector('.App-toolbar__extra-tools-dropdown [data-testid="toolbar-laser"]');
      if (!laser) {
        if (host) { host.remove(); host = null; setLockMenuHost(null); }
        return;
      }
      if (host?.isConnected) return;
      host = document.createElement("div");
      host.className = "extra-tool-lock-slot";
      laser.after(host);
      setLockMenuHost(host);
    };
    const observer = new MutationObserver(syncMenu);
    observer.observe(frame, { childList: true, subtree: true });
    syncMenu();
    return () => { observer.disconnect(); host?.remove(); };
  }, [module, readOnly]);
  const t = translations[locale];

  useEffect(() => {
    if (!editorAPI) return;
    editorAPI.updateScene({
      appState: { activeTool: { ...editorAPI.getAppState().activeTool, locked: true } },
    });
  }, [editorAPI]);

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

  useEffect(() => {
    if (!editorAPI || !module || sceneFingerprint(drawing.scene) === lastFingerprint.current) return;
    const elements = module.reconcileElements(
      editorAPI.getSceneElementsIncludingDeleted(),
      (drawing.scene.elements || []) as Parameters<ExcalidrawModule["reconcileElements"]>[1],
      editorAPI.getAppState(),
    );
    applyingRemote.current = true;
    try {
      const localFiles = editorAPI.getFiles();
      const files = Object.entries(drawing.scene.files || {}).filter(([id]) => !localFiles[id]).map(([, file]) => file);
      if (files.length) editorAPI.addFiles(files as Parameters<EditorAPI["addFiles"]>[0]);
      editorAPI.updateScene({
        elements,
        appState: drawing.scene.appState?.viewBackgroundColor
          ? { viewBackgroundColor: String(drawing.scene.appState.viewBackgroundColor) } : undefined,
        captureUpdate: module.CaptureUpdateAction.NEVER,
      });
      lastFingerprint.current = sceneFingerprint({
        elements: [...editorAPI.getSceneElementsIncludingDeleted()],
        files: editorAPI.getFiles(), appState: editorAPI.getAppState(),
      });
    } finally { applyingRemote.current = false; }
  }, [drawing.scene, editorAPI, module]);

  useEffect(() => {
    if (!editorAPI || drawing.id === localDrawingId) return;
    let disposed = false;
    let stop: (() => Promise<void>) | undefined;
    const collaborators = new Map<string, { value: Collaborator; expires: number }>();
    const render = () => editorAPI.updateScene({
      collaborators: new Map([...collaborators].map(([id, item]) => [id, item.value])) as
        NonNullable<Parameters<EditorAPI["updateScene"]>[0]["collaborators"]>,
    });
    const options = sharedLink ? { query: { share_token: sharedLink.token } } : {};
    setLaserError(false);
    const sender = createLaserSender({
      sessionId: laserSessionId.current,
      send: async body => {
        await pb.send(`/api/drawings/${drawing.id}/laser`, { ...options, method: "POST", body, requestKey: null });
        if (!disposed) setLaserError(false);
      },
      onError: () => { if (!disposed) setLaserError(true); },
    });
    laserSend.current = event => {
      if (!readOnly && !disposed) sender.update(event);
    };
    void pb.realtime.subscribe(`draw-laser/${drawing.id}`, (event: {
      sessionId: string; pointer: { x: number; y: number; tool: "laser" }; button: "down" | "up";
    }) => {
      if (disposed || event.sessionId === laserSessionId.current || !event.pointer ||
          !Number.isFinite(event.pointer.x) || !Number.isFinite(event.pointer.y)) return;
      collaborators.set(event.sessionId, {
        value: { pointer: { ...event.pointer, laserColor: "#e03131" }, button: event.button, username: "Draw" }, expires: Date.now() + 1500,
      });
      render();
    }, options).then(unsubscribe => {
      if (disposed) void unsubscribe(); else stop = unsubscribe;
    }).catch(() => { if (!disposed) setLaserError(true); });
    const expire = setInterval(() => {
      let changed = false;
      for (const [id, item] of collaborators) {
        if (item.expires < Date.now()) { collaborators.delete(id); changed = true; }
      }
      if (changed) render();
    }, 400);
    return () => {
      disposed = true;
      laserSend.current = () => {};
      sender.dispose();
      clearInterval(expire);
      if (stop) void stop();
      editorAPI.updateScene({ collaborators: new Map() });
    };
  }, [drawing.id, editorAPI, pb, readOnly, sharedLink]);

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
    <div className="canvas-frame" ref={frameRef}>
      {lockMenuHost ? createPortal(
        <button type="button" className="dropdown-menu-item dropdown-menu-item-base"
          aria-pressed={toolLocked}
          onClick={() => {
            if (!editorAPI) return;
            const activeTool = editorAPI.getAppState().activeTool;
            editorAPI.updateScene({ appState: { activeTool: { ...activeTool, locked: !activeTool.locked } } });
          }}>
          <span className="dropdown-menu-item__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d={toolLocked ? "M8 10V7a4 4 0 0 1 8 0v3" : "M8 10V7a4 4 0 0 1 8 0"} />
            </svg>
          </span>
          <span className="dropdown-menu-item__text">{locale === "es" ? "Mantener herramienta activa" : "Keep tool active"}</span>
          <span aria-hidden="true">{toolLocked ? "✓" : ""}</span>
        </button>, lockMenuHost,
      ) : null}
      {laserError ? <p className="laser-status" role="status">{t.status.laserUnavailable}</p> : null}
      <Excalidraw
        initialData={drawing.scene}
        excalidrawAPI={setEditorAPI}
        isCollaborating={drawing.id !== localDrawingId && drawing.share_mode !== "restricted"}
        onPointerUpdate={event => laserSend.current(event)}
        langCode={locale === "es" ? "es-ES" : "en"}
        onChange={(elements, appState, files) => {
          setToolLocked((appState as ReturnType<EditorAPI["getAppState"]>).activeTool.locked);
          if (readOnly || applyingRemote.current) return;
          const serialized = serializeAsJSON(elements, appState, files, "local");
          const scene = JSON.parse(serialized) as SceneData;
          // File export removes deleted elements. Collaboration must retain
          // them so an older editor cannot resurrect a deleted shape.
          scene.elements = editorAPI ? [...editorAPI.getSceneElementsIncludingDeleted()] : elements;
          const fingerprint = sceneFingerprint(scene);
          if (fingerprint === lastFingerprint.current) return;
          lastFingerprint.current = fingerprint;
          scheduleSave(scene);
        }}
        renderTopRightUI={(mobile, state) => {
          if (!mobile || readOnly) return null;
          const selectedColors = new Set(editorAPI?.getSceneElements()
            .filter(element => state.selectedElementIds[element.id])
            .map(element => element.strokeColor));
          const mixed = selectedColors.size > 1;
          const color = selectedColors.size === 1 ? [...selectedColors][0] : state.currentItemStrokeColor;
          const label = locale === "es"
            ? `Colores y estilo: ${mixed ? "varios colores" : color}`
            : `Colors and style: ${mixed ? "mixed colors" : color}`;
          return (
          <button className="canvas-quick-color" type="button"
            title={label}
            aria-label={label}
            aria-expanded={state.openMenu === "shape"}
            onClick={() => {
              if (!editorAPI) return;
              const current = editorAPI.getAppState();
              const opening = current.openMenu !== "shape";
              const hasSelection = Object.values(current.selectedElementIds).some(Boolean);
              if (opening && !hasSelection && ["selection", "eraser", "hand", "laser", "custom"].includes(current.activeTool.type)) {
                editorAPI.setActiveTool({ type: "freedraw" });
              }
              editorAPI.updateScene({ appState: { openMenu: opening ? "shape" : null } });
            }}>
            <span className="canvas-color-swatch" aria-hidden="true"
              style={{ background: mixed ? "conic-gradient(#e03131 0deg 90deg, #1971c2 90deg 180deg, #2f9e44 180deg 270deg, #fcc419 270deg)" : color }} />
          </button>
          );
        }}
        viewModeEnabled={readOnly}
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
  message,
  locale,
  onClose,
  pb,
  setLocale,
}: {
  locale: Locale;
  message?: string;
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
      const result = await pb.collection("users").requestOTP(normalizedEmail);

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
            <h1>{t.auth.accessTitle}</h1>
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
            <p className="auth-description">{message || t.auth.cloudPrompt}</p>
            <input
              aria-label={t.auth.email}
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
              aria-label={t.auth.code}
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

function AdminPanel({
  locale,
  onClose,
  pb,
}: {
  locale: Locale;
  onClose: () => void;
  pb: PocketBase;
}) {
  const t = translations[locale];
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [defaultLimitInput, setDefaultLimitInput] = useState(
    String(defaultRegisteredDrawingLimit),
  );
  const [defaultLimitRecordId, setDefaultLimitRecordId] = useState("");
  const [totalDrawings, setTotalDrawings] = useState(0);
  const [status, setStatus] = useState<string>(t.status.loading);
  const [isLoading, setIsLoading] = useState(false);
  const [savingLimitKey, setSavingLimitKey] = useState("");

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);
    setStatus(t.status.loading);

    try {
      const [nextUsers, nextDrawings, settings, drawingLimits] = await Promise.all([
        pb.collection("users").getFullList<AdminUser>({
          sort: "-created",
          fields: "id,email,verified,created,updated",
        }),
        pb.collection("drawings").getFullList<AdminDrawing>({
          sort: "-updated",
          fields: "id,title,owner,created,updated",
        }),
        pb.collection("draw_settings").getFullList<DrawSetting>({
          filter: `key = "${drawingLimitSettingKey}"`,
          fields: "id,key,value",
        }),
        pb.collection("drawing_limits").getFullList<DrawingLimitRecord>({
          fields: "id,owner,maxDrawings",
        }),
      ]);

      const counts = new Map<string, { count: number; lastDrawingAt: string }>();
      const limitByOwner = new Map(
        drawingLimits.map((limit) => [limit.owner, limit]),
      );
      const defaultLimit = normalizeDrawingLimit(settings[0]?.value);

      for (const drawing of nextDrawings) {
        const current = counts.get(drawing.owner) ?? { count: 0, lastDrawingAt: "" };
        counts.set(drawing.owner, {
          count: current.count + 1,
          lastDrawingAt:
            !current.lastDrawingAt || drawing.updated > current.lastDrawingAt
              ? drawing.updated
              : current.lastDrawingAt,
        });
      }

      setUsers(
        nextUsers.map((nextUser) => {
          const userStats = counts.get(nextUser.id);
          const userLimit = limitByOwner.get(nextUser.id);
          return {
            ...nextUser,
            drawingLimit: userLimit ? String(normalizeDrawingLimit(userLimit.maxDrawings)) : "",
            drawingLimitRecordId: userLimit?.id ?? "",
            drawingCount: userStats?.count ?? 0,
            lastDrawingAt: userStats?.lastDrawingAt ?? "",
          };
        }),
      );
      setDefaultLimitInput(String(defaultLimit));
      setDefaultLimitRecordId(settings[0]?.id ?? "");
      setTotalDrawings(nextDrawings.length);
      setStatus(t.status.ready);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.admin.usersError);
    } finally {
      setIsLoading(false);
    }
  }, [pb, t.admin.usersError, t.status.loading, t.status.ready]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const saveDefaultLimit = useCallback(async () => {
    const nextLimit = normalizeDrawingLimit(defaultLimitInput);
    setDefaultLimitInput(String(nextLimit));
    setSavingLimitKey("default");

    try {
      const payload = { key: drawingLimitSettingKey, value: nextLimit };
      const setting = defaultLimitRecordId
        ? await pb.collection("draw_settings").update<DrawSetting>(
            defaultLimitRecordId,
            payload,
          )
        : await pb.collection("draw_settings").create<DrawSetting>(payload);

      setDefaultLimitRecordId(setting.id);
      setStatus(t.status.saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.status.couldNotSave);
    } finally {
      setSavingLimitKey("");
    }
  }, [defaultLimitInput, defaultLimitRecordId, pb, t.status.couldNotSave, t.status.saved]);

  const updateUserLimitInput = useCallback((userId: string, value: string) => {
    setUsers((items) =>
      items.map((item) =>
        item.id === userId ? { ...item, drawingLimit: value } : item,
      ),
    );
  }, []);

  const saveUserLimit = useCallback(
    async (adminUser: AdminUserRow) => {
      const key = `user-${adminUser.id}`;
      setSavingLimitKey(key);

      try {
        if (emptyLimitValue(adminUser.drawingLimit)) {
          if (adminUser.drawingLimitRecordId) {
            await pb.collection("drawing_limits").delete(adminUser.drawingLimitRecordId);
          }
          setUsers((items) =>
            items.map((item) =>
              item.id === adminUser.id
                ? { ...item, drawingLimit: "", drawingLimitRecordId: "" }
                : item,
            ),
          );
          setStatus(t.status.saved);
          return;
        }

        const nextLimit = normalizeDrawingLimit(adminUser.drawingLimit);
        const payload = { owner: adminUser.id, maxDrawings: nextLimit };
        const savedLimit = adminUser.drawingLimitRecordId
          ? await pb.collection("drawing_limits").update<DrawingLimitRecord>(
              adminUser.drawingLimitRecordId,
              payload,
            )
          : await pb.collection("drawing_limits").create<DrawingLimitRecord>(payload);

        setUsers((items) =>
          items.map((item) =>
            item.id === adminUser.id
              ? {
                  ...item,
                  drawingLimit: String(nextLimit),
                  drawingLimitRecordId: savedLimit.id,
                }
              : item,
          ),
        );
        setStatus(t.status.saved);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t.status.couldNotSave);
      } finally {
        setSavingLimitKey("");
      }
    },
    [pb, t.status.couldNotSave, t.status.saved],
  );

  return (
    <div className="auth-shell auth-modal">
      <section className="admin-panel">
        <div className="admin-header">
          <div>
            <p className="eyebrow">{t.appName}</p>
            <h1>{t.admin.title}</h1>
          </div>
          <div className="admin-header-actions">
            <button
              className="icon-text-button"
              disabled={isLoading}
              type="button"
              onClick={() => void loadAdminData()}
            >
              <Icon name="barChart" />
              <span>{t.admin.refresh}</span>
            </button>
            <button
              aria-label={t.labels.close}
              className="icon-button"
              title={t.labels.close}
              type="button"
              onClick={onClose}
            >
              <Icon name="x" />
            </button>
          </div>
        </div>

        <div className="admin-stats">
          <div>
            <span>{t.admin.totalUsers}</span>
            <strong>{users.length}</strong>
          </div>
          <div>
            <span>{t.admin.totalDrawings}</span>
            <strong>{totalDrawings}</strong>
          </div>
        </div>

        <label className="admin-default-limit">
          <span>{t.admin.defaultDrawingLimit}</span>
          <input
            disabled={savingLimitKey === "default"}
            inputMode="numeric"
            min="1"
            max="999"
            type="number"
            value={defaultLimitInput}
            onBlur={() => void saveDefaultLimit()}
            onChange={(event) => setDefaultLimitInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </label>

        <p className="admin-status">{status}</p>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t.admin.user}</th>
                <th>{t.admin.drawings}</th>
                <th>{t.admin.limit}</th>
                <th>{t.admin.lastActivity}</th>
              </tr>
            </thead>
            <tbody>
              {users.length ? (
                users.map((adminUser) => (
                  <tr key={adminUser.id}>
                    <td>
                      <span>{adminUser.email}</span>
                    </td>
                    <td>{adminUser.drawingCount}</td>
                    <td>
                      <input
                        aria-label={`${t.admin.limit} ${adminUser.email}`}
                        className="admin-limit-input"
                        disabled={savingLimitKey === `user-${adminUser.id}`}
                        inputMode="numeric"
                        min="1"
                        max="999"
                        placeholder={defaultLimitInput}
                        type="number"
                        value={adminUser.drawingLimit}
                        onBlur={() => void saveUserLimit(adminUser)}
                        onChange={(event) =>
                          updateUserLimitInput(adminUser.id, event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </td>
                    <td>
                      {adminUser.lastDrawingAt
                        ? formatTime(adminUser.lastDrawingAt, locale)
                        : t.admin.unknown}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>{t.admin.noUsers}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SharePanel({
  drawing,
  locale,
  onClose,
  updateSharing,
}: {
  drawing: Drawing;
  locale: Locale;
  onClose: () => void;
  updateSharing: (mode: ShareMode) => Promise<void>;
}) {
  const t = translations[locale];
  const [mode, setMode] = useState<ShareMode>(drawing.share_mode);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const link = mode === "restricted" || !drawing.share_token
    ? ""
    : buildShareUrl(drawing.id, drawing.share_token);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const changeMode = async (nextMode: ShareMode) => {
    setMode(nextMode);
    setIsSaving(true);
    setMessage("");
    try {
      await updateSharing(nextMode);
    } catch {
      setMode(drawing.share_mode);
      setMessage(t.status.couldNotShare);
    } finally {
      setIsSaving(false);
    }
  };

  const copyLink = async () => {
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setMessage(t.share.copied);
    } catch {
      setMessage(t.status.couldNotShare);
    }
  };

  const description = mode === "edit"
    ? t.share.editDescription
    : mode === "view"
      ? t.share.viewDescription
      : t.share.restrictedDescription;

  return (
    <div className="share-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section aria-labelledby="share-title" aria-modal="true" className="share-panel" role="dialog">
        <header className="share-header">
          <div>
            <p className="eyebrow">{t.labels.share}</p>
            <h2 id="share-title">{t.share.title}</h2>
          </div>
          <button
            aria-label={t.labels.close}
            className="icon-button"
            title={t.labels.close}
            type="button"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p className="share-description">{t.share.description}</p>
        <label htmlFor="share-mode">{t.share.access}</label>
        <select
          autoFocus
          disabled={isSaving}
          id="share-mode"
          value={mode}
          onChange={(event) => void changeMode(event.currentTarget.value as ShareMode)}
        >
          <option value="restricted">{t.share.restricted}</option>
          <option value="view">{t.share.view}</option>
          <option value="edit">{t.share.edit}</option>
        </select>
        <p className="share-mode-description">{description}</p>
        {link ? (
          <div className="share-link-row">
            <label className="sr-only" htmlFor="share-link">{t.share.linkLabel}</label>
            <input id="share-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
            <button className="primary" type="button" onClick={() => void copyLink()}>
              {t.share.copyLink}
            </button>
          </div>
        ) : null}
        <p aria-live="polite" className="share-status">{isSaving ? t.status.saving : message}</p>
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
    barChart: [
      "M4 19V5",
      "M4 19h16",
      "M8 16v-5",
      "M12 16V8",
      "M16 16v-8",
    ],
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
    share: [
      "M12 3v12",
      "M8 7l4-4 4 4",
      "M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
    ],
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

function DeleteDrawingDialog({ drawing, locale, onClose, onConfirm }: {
  drawing: Drawing;
  locale: Locale;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const es = locale === "es";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onClose();
      if (event.key !== "Tab") return;
      const buttons = panel?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch {
      setError(es ? "No se pudo eliminar el dibujo. Inténtalo de nuevo." : "Could not delete the drawing. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return <div className="share-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={panelRef} className="share-panel delete-drawing-panel" role="alertdialog"
      aria-modal="true" aria-labelledby="delete-drawing-title" aria-describedby="delete-drawing-description" aria-busy={busy}>
      <div className="delete-drawing-icon"><Icon name="trash" /></div>
      <h2 id="delete-drawing-title">{es ? "¿Eliminar dibujo?" : "Delete drawing?"}</h2>
      <p id="delete-drawing-description">{es ? "Se eliminará" : "This will delete"} <strong>“{drawing.title.trim() || translations[locale].terms.untitledDrawing}”</strong>. {es ? "Esta acción no se puede deshacer." : "This action cannot be undone."}</p>
      {error ? <p className="danger" role="alert">{error}</p> : null}
      <footer className="delete-drawing-actions">
        <button type="button" disabled={busy} onClick={onClose}>{es ? "Cancelar" : "Cancel"}</button>
        <button type="button" className="delete-confirm" disabled={busy} onClick={() => void confirm()}>
          {busy ? (es ? "Eliminando…" : "Deleting…") : translations[locale].labels.delete}
        </button>
      </footer>
    </section>
  </div>;
}
