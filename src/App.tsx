import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TEMPLATE_ID = "1ViQYMPmpYOs4Xe1h6A9WKT3jARYX1oapWf0Ge44uVdk";

const GENERATION_MESSAGES = [
  "Subiendo archivos…",
  "Analizando radicación…",
  "Leyendo soportes…",
  "Extrayendo datos de cédulas…",
  "Generando minuta…",
  "Armando escritura acto por acto…",
  "Exportando a PDF…",
  "Casi listo…",
] as const;

const MAINTENANCE_MESSAGES = [
  "Leyendo comentarios del Word revisado…",
  "Codex detectando patrones corregibles…",
  "Aplicando un ajuste pequeño y seguro al backend…",
  "Ejecutando la verificación mínima relevante…",
  "Esperando confirmación final del despliegue…",
] as const;

const ITERATION_MESSAGES = [
  "Releyendo los insumos del caso…",
  "Aplicando el feedback al borrador…",
  "Regenerando la minuta…",
  "Rearmando la escritura…",
  "Preparando Word, PDF y reporte de cambios…",
] as const;

type StatusMode = "idle" | "generation" | "maintenance" | "iteration";
type StatusState = "idle" | "loading" | "success" | "error";
type WorkflowMode =
  | "start"
  | "drafted"
  | "feedback"
  | "locked"
  | "validation"
  | "iterating"
  | "attention";
type BannerTone = "pending" | "ready" | "neutral" | "danger";
type EventTone = "info" | "success" | "warn" | "error";

interface ArtifactLinks {
  docx_url: string;
  pdf_url: string;
  change_report_url?: string | null;
}

interface ActionLinks {
  case_url: string;
  feedback_upload_url: string;
  next_iteration_url: string;
}

interface FeedbackStatus {
  uploaded: boolean;
  comments_count: number;
}

interface MaintenanceInfo {
  status: string;
  message?: string | null;
  run_id?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  radicado?: string | null;
  iteration?: number | null;
}

interface IterationSummary {
  iteration: number;
  status: string;
  comments_count: number;
  feedback_uploaded: boolean;
  maintenance_status?: string | null;
  artifacts: ArtifactLinks;
}

interface CaseResponse {
  ok: boolean;
  radicado: string;
  current_iteration: number;
  status: string;
  artifacts: ArtifactLinks;
  actions: ActionLinks;
  feedback: FeedbackStatus;
  maintenance?: MaintenanceInfo | null;
  iterations: IterationSummary[];
  docx_path?: string;
  pdf_path?: string;
  download_url?: string;
}

interface MaintenanceResponse {
  ok: boolean;
  maintenance?: MaintenanceInfo | null;
}

interface StatusMessage {
  state: StatusState;
  msg: string;
  mode: StatusMode;
}

interface EventLogEntry {
  id: string;
  at: string;
  title: string;
  detail: string;
  tone: EventTone;
}

interface BannerInfo {
  tone: BannerTone;
  title: string;
  text: string;
}

function resolveUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
    return `${API_BASE}${normalizedPath}`;
  }
  return `${API_BASE}${normalizedPath}`;
}

function getErrorMessage(err: unknown, fallback: string): string {
  const error = err as {
    message?: string;
    response?: {
      status?: number;
      data?: {
        detail?: string;
        message?: string;
      };
    };
  };

  if (error?.response?.status === 502) {
    return "El backend sigue reiniciándose o actualizándose. Espera un poco y vuelve a intentar.";
  }

  return (
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

function extractCaseHintFromFilename(filename: string): string | null {
  const match = (filename || "").match(/(?:caso|radicado)[\s_-]*(\d{4,})/i);
  return match ? match[1] : null;
}

function formatClock(date = new Date()): string {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function parseUtcToMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}

function describeIteration(iteration: number): string {
  if (iteration <= 1) {
    return "Esta es la primera versión de este radicado.";
  }
  return `Ves Iteración ${iteration} porque este mismo radicado ya fue regenerado ${iteration - 1} vez/veces antes. Si quieres medir desde cero, usa Empezar otro caso.`;
}

function getWorkflowMode(params: {
  interactionLocked: boolean;
  maintenanceCompleted: boolean;
  maintenanceSkipped: boolean;
  maintenanceFailed: boolean;
  feedbackUploaded: boolean;
  currentIteration: number;
  hasResult: boolean;
}): WorkflowMode {
  const {
    interactionLocked,
    maintenanceCompleted,
    maintenanceSkipped,
    maintenanceFailed,
    feedbackUploaded,
    currentIteration,
    hasResult,
  } = params;

  if (interactionLocked) return "locked";
  if (maintenanceCompleted) return "validation";
  if (maintenanceSkipped) return "iterating";
  if (maintenanceFailed) return "attention";
  if (feedbackUploaded) return "feedback";
  if (currentIteration > 1) return "validation";
  if (hasResult) return "drafted";
  return "start";
}

function getWorkflowBadge(mode: WorkflowMode): string {
  switch (mode) {
    case "locked":
      return "Backend actualizándose";
    case "validation":
      return "Listo para validar";
    case "iterating":
      return "Listo para iterar";
    case "attention":
      return "Revisión manual";
    case "feedback":
      return "Feedback registrado";
    case "drafted":
      return "Borrador listo";
    default:
      return "Listo para comenzar";
  }
}

function getLoadingConfig(mode: StatusMode): { label: string; messages: readonly string[] } {
  switch (mode) {
    case "maintenance":
      return {
        label: "Mejora del sistema en curso",
        messages: MAINTENANCE_MESSAGES,
      };
    case "iteration":
      return {
        label: "Generando nueva iteración",
        messages: ITERATION_MESSAGES,
      };
    default:
      return {
        label: "Generando borrador",
        messages: GENERATION_MESSAGES,
      };
  }
}

function getResultBanner(params: {
  maintenancePending: boolean;
  maintenanceCompleted: boolean;
  maintenanceSkipped: boolean;
  maintenanceFailed: boolean;
  feedbackUploaded: boolean;
  maintenance: MaintenanceInfo | null;
  currentIteration: number;
}): BannerInfo {
  const {
    maintenancePending,
    maintenanceCompleted,
    maintenanceSkipped,
    maintenanceFailed,
    feedbackUploaded,
    maintenance,
    currentIteration,
  } = params;

  if (maintenancePending) {
    return {
      tone: "pending",
      title: "Mejora del sistema en curso",
      text:
        maintenance?.message ||
        "El backend se está actualizando con este feedback. La interfaz permanecerá bloqueada hasta que termine.",
    };
  }
  if (maintenanceCompleted) {
    return {
      tone: "ready",
      title: "Backend actualizado",
      text:
        maintenance?.message ||
        "La mejora global del backend terminó. Ahora sí puedes generar la siguiente iteración para validar el cambio.",
    };
  }
  if (maintenanceSkipped) {
    return {
      tone: "neutral",
      title: "Sin mejora global aplicada",
      text:
        maintenance?.message ||
        "Para este feedback no se aplicó un cambio global del backend. La siguiente iteración solo probará el mismo caso.",
    };
  }
  if (maintenanceFailed) {
    return {
      tone: "danger",
      title: "Actualización automática fallida",
      text:
        maintenance?.message ||
        "La actualización automática falló. Puedes continuar con el caso, pero ya no estarías validando una mejora global aplicada con éxito.",
    };
  }
  if (feedbackUploaded) {
    return {
      tone: "neutral",
      title: "Feedback registrado",
      text:
        "El Word revisado ya quedó asociado a este caso. Cuando corresponda, usa Generar nueva iteración para seguir probando el mismo radicado.",
    };
  }
  if (currentIteration > 1) {
    return {
      tone: "ready",
      title: "Iteración lista para validar",
      text:
        "Esta versión ya refleja un nuevo intento sobre el mismo radicado. Compárala con el Word anterior y descarga el reporte de cambios para verificar la diferencia.",
    };
  }
  return {
    tone: "ready",
    title: "Borrador listo",
    text:
      "Si este borrador ya sirve, descarga Word o PDF y continúa. Si quieres mejorar el sistema, sube el Word revisado con comentarios.",
  };
}

function LoadingCard(props: {
  mode: StatusMode;
  elapsedSec: number;
  loadingStep: number;
  uploadPct: number;
}) {
  const { mode, elapsedSec, loadingStep, uploadPct } = props;
  const { label, messages } = getLoadingConfig(mode);
  const currentMessage = messages[loadingStep % messages.length];
  const showUploadProgress = mode === "generation" && uploadPct > 0 && uploadPct < 100;

  return (
    <div className="loadingCard">
      <div className="loadingLabel">{label}</div>

      {showUploadProgress && (
        <div className="progressWrap">
          <div className="progressBar">
            <div className="progressFill" style={{ width: `${uploadPct}%` }} />
          </div>
          <div className="progressText">{uploadPct}%</div>
        </div>
      )}

      <div className="spinnerWrap">
        <div className="spinner" />
        <div className="spinnerCopy">
          <div className="spinnerText">{currentMessage}</div>
          <div className="spinnerMeta">{elapsedSec}s transcurridos</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [loadingStep, setLoadingStep] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [cedulaFiles, setCedulaFiles] = useState<File[]>([]);
  const [docsFiles, setDocsFiles] = useState<File[]>([]);
  const [feedbackFile, setFeedbackFile] = useState<File | null>(null);
  const [pickerVersion, setPickerVersion] = useState(0);

  const [comentario, setComentario] = useState("");
  const [status, setStatus] = useState<StatusMessage>({
    state: "idle",
    msg: "",
    mode: "idle",
  });
  const [result, setResult] = useState<CaseResponse | null>(null);
  const [globalMaintenance, setGlobalMaintenance] = useState<MaintenanceInfo | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [isUploadingFeedback, setIsUploadingFeedback] = useState(false);
  const [isRunningNext, setIsRunningNext] = useState(false);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([
    {
      id: crypto.randomUUID(),
      at: formatClock(),
      title: "Interfaz lista",
      detail: "Sube documentos para generar un borrador o continuar con un caso existente.",
      tone: "info",
    },
  ]);

  const lastStatusKeyRef = useRef("");
  const lastMaintenanceKeyRef = useRef("");
  const lastIterationKeyRef = useRef("");

  const canSubmit = useMemo(() => docsFiles.length > 0, [docsFiles]);
  const currentIteration = result?.current_iteration || 0;
  const feedbackUploaded = Boolean(result?.feedback?.uploaded);
  const canUploadFeedback = Boolean(result?.actions?.feedback_upload_url);
  const maintenance = result?.maintenance || null;
  const maintenanceStatus = maintenance?.status || null;
  const maintenancePending = Boolean(
    feedbackUploaded && ["queued", "running"].includes(maintenanceStatus)
  );
  const maintenanceFailed = maintenanceStatus === "failed";
  const maintenanceCompleted = maintenanceStatus === "completed";
  const maintenanceSkipped = maintenanceStatus === "skipped";
  const globalMaintenanceStatus = globalMaintenance?.status || null;
  const globalMaintenancePending = Boolean(
    ["queued", "running"].includes(globalMaintenanceStatus)
  );
  const interactionLocked = maintenancePending || globalMaintenancePending;
  const canRunNextIteration = Boolean(
    result?.actions?.next_iteration_url && feedbackUploaded && !interactionLocked
  );
  const workflowMode = getWorkflowMode({
    interactionLocked,
    maintenanceCompleted,
    maintenanceSkipped,
    maintenanceFailed,
    feedbackUploaded,
    currentIteration,
    hasResult: Boolean(result),
  });
  const resultBanner = getResultBanner({
    maintenancePending,
    maintenanceCompleted,
    maintenanceSkipped,
    maintenanceFailed,
    feedbackUploaded,
    maintenance,
    currentIteration,
  });

  const activeMaintenance = maintenancePending ? maintenance : globalMaintenancePending ? globalMaintenance : null;
  const activeMaintenanceSince =
    parseUtcToMs(activeMaintenance?.started_at) ??
    parseUtcToMs(activeMaintenance?.queued_at) ??
    null;
  const liveElapsedSec =
    activeMaintenanceSince !== null
      ? Math.max(0, Math.floor((Date.now() - activeMaintenanceSince) / 1000))
      : elapsedSec;
  const docxUrl = resolveUrl(result?.artifacts?.docx_url);
  const pdfUrl = resolveUrl(result?.artifacts?.pdf_url);
  const changeReportUrl = resolveUrl(result?.artifacts?.change_report_url);
  const globalBannerText = globalMaintenancePending
    ? globalMaintenance?.message ||
      "El backend se está actualizando con feedback experto. Toda la interfaz queda bloqueada hasta que termine."
    : null;

  function appendLog(title: string, detail: string, tone: EventTone = "info") {
    setEventLog((current) => [
      {
        id: crypto.randomUUID(),
        at: formatClock(),
        title,
        detail,
        tone,
      },
      ...current,
    ].slice(0, 14));
  }

  useEffect(() => {
    if (status.state !== "loading") {
      setLoadingStep(0);
      setElapsedSec(0);
      return;
    }

    const { messages } = getLoadingConfig(status.mode);
    const startedAt = Date.now();
    const msgTimer = window.setInterval(() => {
      setLoadingStep((step) => (step + 1) % messages.length);
    }, 2500);
    const secTimer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(msgTimer);
      window.clearInterval(secTimer);
    };
  }, [status.mode, status.state]);

  useEffect(() => {
    if (!status.msg) return;
    const key = `${status.state}|${status.mode}|${status.msg}`;
    if (key === lastStatusKeyRef.current) return;
    lastStatusKeyRef.current = key;

    const tone: EventTone =
      status.state === "error"
        ? "error"
        : status.state === "success"
          ? "success"
          : "info";
    const title =
      status.mode === "maintenance"
        ? "Estado de mejora del sistema"
        : status.mode === "iteration"
          ? "Estado de nueva iteración"
          : status.mode === "generation"
            ? "Estado de generación"
            : "Estado de la interfaz";
    appendLog(title, status.msg, tone);
  }, [status.msg, status.mode, status.state]);

  useEffect(() => {
    const key = globalMaintenance
      ? `${globalMaintenance.status}|${globalMaintenance.radicado}|${globalMaintenance.iteration}|${globalMaintenance.message}`
      : "none";
    if (key === lastMaintenanceKeyRef.current) return;
    lastMaintenanceKeyRef.current = key;

    if (!globalMaintenance) {
      appendLog("Mantenimiento global", "No hay una actualización global del backend en curso.", "info");
      return;
    }

    appendLog(
      "Mantenimiento global",
      `Estado ${globalMaintenance.status} para el radicado ${globalMaintenance.radicado || "sin radicado"}${globalMaintenance.iteration ? ` en iteración ${globalMaintenance.iteration}` : ""}. ${globalMaintenance.message || ""}`.trim(),
      globalMaintenance.status === "failed"
        ? "error"
        : globalMaintenance.status === "completed"
          ? "success"
          : globalMaintenance.status === "skipped"
            ? "warn"
            : "info",
    );
  }, [globalMaintenance]);

  useEffect(() => {
    if (!result) return;
    const key = `${result.radicado}|${result.current_iteration}|${result.status}`;
    if (key === lastIterationKeyRef.current) return;
    lastIterationKeyRef.current = key;
    appendLog(
      "Caso activo",
      `Radicado ${result.radicado} en iteración ${result.current_iteration} con estado ${result.status}.`,
      "info",
    );
  }, [result]);

  useEffect(() => {
    let cancelled = false;

    const refreshGlobalMaintenance = async () => {
      try {
        const response = await axios.get<MaintenanceResponse>(resolveUrl("/maintenance/backend") as string);
        if (!cancelled) {
          setGlobalMaintenance(response.data?.maintenance || null);
        }
      } catch (_err) {
        if (!cancelled) {
          setGlobalMaintenance(null);
        }
      }
    };

    refreshGlobalMaintenance();
    const timer = window.setInterval(refreshGlobalMaintenance, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!result?.actions?.case_url || !maintenancePending) {
      return undefined;
    }

    let cancelled = false;
    const refreshCase = async () => {
      try {
        const response = await axios.get<CaseResponse>(resolveUrl(result.actions.case_url) as string);
        if (!cancelled) {
          setResult(response.data);
        }
      } catch (_err) {
        // During backend redeploy, transient read failures are expected.
      }
    };

    refreshCase();
    const timer = window.setInterval(refreshCase, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [maintenancePending, result?.actions?.case_url]);

  useEffect(() => {
    if (!feedbackUploaded) return;

    if (maintenancePending) {
      setStatus({
        state: "loading",
        mode: "maintenance",
        msg:
          maintenance?.message ||
          "El backend se está actualizando con este feedback.",
      });
      return;
    }

    if (maintenanceCompleted) {
      setStatus({
        state: "success",
        mode: "idle",
        msg:
          maintenance?.message ||
          "Backend actualizado. Ya puedes generar la siguiente iteración.",
      });
      return;
    }

    if (maintenanceSkipped) {
      setStatus({
        state: "success",
        mode: "idle",
        msg:
          maintenance?.message ||
          "No se aplicó un cambio global automático. Ya puedes generar la siguiente iteración para validar solo este caso.",
      });
      return;
    }

    if (maintenanceFailed) {
      setStatus({
        state: "error",
        mode: "idle",
        msg:
          maintenance?.message ||
          "La actualización automática del backend falló. Puedes continuar, pero esta iteración ya no valida una mejora global aplicada.",
      });
    }
  }, [
    feedbackUploaded,
    maintenance,
    maintenanceCompleted,
    maintenanceFailed,
    maintenancePending,
    maintenanceSkipped,
  ]);

  function onPickCedula(event: React.ChangeEvent<HTMLInputElement>) {
    setCedulaFiles(Array.from(event.target.files || []));
  }

  function onPickDocs(event: React.ChangeEvent<HTMLInputElement>) {
    setDocsFiles(Array.from(event.target.files || []));
  }

  function onPickFeedback(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    const hintedCase = extractCaseHintFromFilename(file?.name || "");
    if (file && result?.radicado && hintedCase && hintedCase !== String(result.radicado)) {
      setFeedbackFile(null);
      setStatus({
        state: "error",
        mode: "idle",
        msg: `Ese Word revisado parece pertenecer al radicado ${hintedCase}, no al caso actual ${result.radicado}.`,
      });
      event.target.value = "";
      return;
    }
    setFeedbackFile(file);
  }

  function onResetCase() {
    setCedulaFiles([]);
    setDocsFiles([]);
    setFeedbackFile(null);
    setComentario("");
    setStatus({ state: "idle", msg: "", mode: "idle" });
    setResult(null);
    setUploadPct(0);
    setLoadingStep(0);
    setElapsedSec(0);
    setPickerVersion((value) => value + 1);
    appendLog("Nuevo caso", "Se limpió el radicado actual para comenzar desde cero.", "info");
  }

  function removeCedula(index: number) {
    setCedulaFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function removeDoc(index: number) {
    setDocsFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function onSubmit() {
    setResult(null);
    setFeedbackFile(null);
    setUploadPct(0);
    setLoadingStep(0);
    setElapsedSec(0);

    if (!canSubmit) {
      setStatus({
        state: "error",
        mode: "idle",
        msg: "Faltan documentos base. Debes subir al menos un documento.",
      });
      return;
    }

    if (globalMaintenancePending) {
      setStatus({
        state: "error",
        mode: "idle",
        msg:
          globalMaintenance?.message ||
          "El backend está actualizándose con feedback experto. Espera a que termine antes de generar un nuevo caso.",
      });
      return;
    }

    try {
      setStatus({
        state: "loading",
        mode: "generation",
        msg: "Generando primera iteración…",
      });

      const form = new FormData();
      cedulaFiles.forEach((file) => form.append("cedula", file));
      docsFiles.forEach((file) => form.append("documentos", file));
      if ((comentario || "").trim()) {
        form.append("comentario", comentario);
      }
      form.append("template_id", TEMPLATE_ID);

      const response = await axios.post<CaseResponse>(`${API_BASE}/notaria-v63-universal`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (!event.total) return;
          setUploadPct(Math.round((event.loaded * 100) / event.total));
        },
      });

      setResult(response.data);
      setStatus({
        state: "success",
        mode: "idle",
        msg: "Primera iteración generada.",
      });
    } catch (err) {
      setStatus({
        state: "error",
        mode: "idle",
        msg: getErrorMessage(err, "No fue posible generar el borrador."),
      });
    }
  }

  async function onUploadFeedback() {
    if (!feedbackFile || !canUploadFeedback) {
      setStatus({
        state: "error",
        mode: "idle",
        msg: "Selecciona primero el Word revisado con comentarios.",
      });
      return;
    }

    if (interactionLocked) {
      setStatus({
        state: "error",
        mode: "idle",
        msg:
          maintenance?.message ||
          globalMaintenance?.message ||
          "El backend sigue actualizándose. Espera a que termine antes de enviar otro feedback.",
      });
      return;
    }

    try {
      setIsUploadingFeedback(true);
      setStatus({ state: "idle", msg: "", mode: "idle" });

      const form = new FormData();
      form.append("feedback_docx", feedbackFile);

      const response = await axios.post<CaseResponse>(
        resolveUrl(result?.actions.feedback_upload_url) as string,
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      );

      setResult(response.data);
      setFeedbackFile(null);
      setStatus({
        state: "loading",
        mode: "maintenance",
        msg:
          "Feedback cargado. Codex está actualizando el backend con esta revisión; la interfaz se desbloqueará automáticamente cuando termine.",
      });
    } catch (err) {
      setStatus({
        state: "error",
        mode: "idle",
        msg: getErrorMessage(err, "No fue posible subir el feedback."),
      });
    } finally {
      setIsUploadingFeedback(false);
    }
  }

  async function onNextIteration() {
    if (!canRunNextIteration) {
      setStatus({
        state: "error",
        mode: "idle",
        msg:
          interactionLocked
            ? "El backend todavía se está actualizando. La siguiente iteración se habilitará automáticamente cuando termine."
            : "Sube y envía primero el Word revisado con comentarios.",
      });
      return;
    }

    try {
      setIsRunningNext(true);
      setUploadPct(0);
      setStatus({
        state: "loading",
        mode: "iteration",
        msg: "Generando nueva iteración…",
      });

      const response = await axios.post<CaseResponse>(
        resolveUrl(result?.actions.next_iteration_url) as string,
      );

      setResult(response.data);
      setFeedbackFile(null);
      setStatus({
        state: "success",
        mode: "idle",
        msg: `Iteración ${response.data.current_iteration} generada.`,
      });
    } catch (err) {
      setStatus({
        state: "error",
        mode: "idle",
        msg: getErrorMessage(err, "No fue posible generar la siguiente iteración."),
      });
    } finally {
      setIsRunningNext(false);
    }
  }

  const processSteps = [
    {
      id: "draft",
      label: "Borrador",
      active: status.mode === "generation",
      done: currentIteration >= 1,
    },
    {
      id: "feedback",
      label: "Feedback",
      active: feedbackUploaded && !interactionLocked,
      done: feedbackUploaded,
    },
    {
      id: "backend",
      label: "Backend",
      active: interactionLocked,
      done: maintenanceCompleted || maintenanceSkipped,
    },
    {
      id: "validation",
      label: "Validación",
      active: status.mode === "iteration",
      done: currentIteration > 1 && result?.status === "generated",
    },
  ];

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">Notar-IA</h1>

        <div className="guidePanel">
          <div className="guideHeader">
            <div>
              <div className="guideEyebrow">Modo de uso</div>
              <div className="guideTitle">Prueba rápida o mejora del sistema</div>
            </div>
            <div className={`guideBadge ${workflowMode}`}>{getWorkflowBadge(workflowMode)}</div>
          </div>

          <div className="guideGrid">
            <div className="guideCard">
              <div className="guideCardTitle">Uso rápido</div>
              <ol className="guideList">
                <li>Sube escaneos y documentos.</li>
                <li>Genera un nuevo borrador.</li>
                <li>Descarga Word o PDF y sigue trabajando si ya quedó bien.</li>
              </ol>
            </div>

            <div className="guideCard accent">
              <div className="guideCardTitle">Mejora del sistema</div>
              <ol className="guideList">
                <li>Genera un nuevo borrador.</li>
                <li>Sube el Word revisado con comentarios del mismo caso.</li>
                <li>Espera a que el backend termine de actualizarse.</li>
                <li>Genera una nueva iteración para validar la mejora.</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="processStrip">
          {processSteps.map((step) => (
            <div
              key={step.id}
              className={`processChip ${step.active ? "active" : ""} ${step.done ? "done" : ""}`}
            >
              <span className="processChipLabel">{step.label}</span>
            </div>
          ))}
        </div>

        <div className="workspaceGrid">
          <section className="workspaceColumn inputColumn">
            {globalBannerText && !maintenancePending && (
              <div className="learningBanner pending">
                <div className="learningBannerTitle">Backend actualizándose</div>
                <div className="learningBannerText">{globalBannerText}</div>
              </div>
            )}

            <div className="pickerGrid">
              <label className="bigPicker">
                <input
                  key={`cedula-${pickerVersion}`}
                  className="hiddenInput"
                  type="file"
                  multiple
                  accept=".pdf,image/*"
                  onChange={onPickCedula}
                  disabled={interactionLocked}
                />
                <div className="bigPickerInner">
                  <div className="bigPickerText">Escaneos</div>
                  <div className="bigPickerSub">
                    {cedulaFiles.length > 0
                      ? `${cedulaFiles.length} archivo(s) seleccionado(s)`
                      : "Cédula(s), tarjetas o escaneos de identidad"}
                  </div>
                </div>
              </label>

              <label className="bigPicker">
                <input
                  key={`docs-${pickerVersion}`}
                  className="hiddenInput"
                  type="file"
                  multiple
                  accept=".pdf,image/*"
                  onChange={onPickDocs}
                  disabled={interactionLocked}
                />
                <div className="bigPickerInner">
                  <div className="bigPickerText">Documentos</div>
                  <div className="bigPickerSub">
                    {docsFiles.length > 0
                      ? `${docsFiles.length} archivo(s) seleccionados`
                      : "Soportes del acto, certificados y anexos"}
                  </div>
                </div>
              </label>
            </div>

            <div className="filesColumns">
              {cedulaFiles.length > 0 && (
                <div className="filesBox">
                  <div className="filesHeader">Escaneos</div>
                  <ul className="filesList">
                    {cedulaFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="fileRow">
                        <span className="fileName">{file.name}</span>
                        <button
                          className="linkBtn"
                          type="button"
                          onClick={() => removeCedula(index)}
                          disabled={interactionLocked}
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {docsFiles.length > 0 && (
                <div className="filesBox">
                  <div className="filesHeader">Documentos</div>
                  <ul className="filesList">
                    {docsFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="fileRow">
                        <span className="fileName">{file.name}</span>
                        <button
                          className="linkBtn"
                          type="button"
                          onClick={() => removeDoc(index)}
                          disabled={interactionLocked}
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="field">
              <label className="label">Comentario del caso</label>
              <textarea
                className="textarea"
                value={comentario}
                onChange={(event) => setComentario(event.target.value)}
                placeholder="Ej: El cliente solicita entrega inmediata."
                disabled={interactionLocked}
              />
            </div>

            {!result && (
              <button
                className="primaryBtn"
                disabled={!canSubmit || status.state === "loading" || interactionLocked}
                onClick={onSubmit}
              >
                {status.state === "loading"
                  ? "Procesando..."
                  : interactionLocked
                    ? "Backend actualizándose"
                    : "Generar borrador"}
              </button>
            )}

            {status.state === "loading" && (
              <LoadingCard
                mode={status.mode}
                elapsedSec={liveElapsedSec}
                loadingStep={loadingStep}
                uploadPct={uploadPct}
              />
            )}

            {status.state !== "idle" && (
              <div className={`status ${status.state}`}>{status.msg}</div>
            )}

            <div className="hint">
              <div>
                <b>Requisito para enviar:</b> al menos 1 documento base
              </div>
              <div className="small">
                Endpoint: <code>{API_BASE}/notaria-v63-universal</code>
              </div>
              <div className="small">
                template_id fijo: <code>{TEMPLATE_ID}</code>
              </div>
            </div>
          </section>

          <section className="workspaceColumn resultColumn">
            {result ? (
              <div className="resultBox">
                <div className="resultHeader">
                  <div>
                    <div className="resultTitle">
                      Caso {result.radicado} · Iteración {result.current_iteration}
                    </div>
                    <div className="resultSubtitle">{describeIteration(currentIteration)}</div>
                  </div>
                  <button
                    className="secondaryBtn resultResetBtn"
                    type="button"
                    onClick={onResetCase}
                    disabled={interactionLocked || isUploadingFeedback || isRunningNext}
                  >
                    Empezar otro caso
                  </button>
                </div>

                <div className="resultLayout">
                  <div className="resultSummary">
                    <div className="metaGrid">
                      <div className="metaItem">
                        <span className="metaLabel">Estado</span>
                        <span className="metaValue">{result.status}</span>
                      </div>
                      <div className="metaItem">
                        <span className="metaLabel">Feedback</span>
                        <span className="metaValue">
                          {feedbackUploaded
                            ? `${result.feedback?.comments_count || 0} comentario(s)`
                            : "Pendiente"}
                        </span>
                      </div>
                      <div className="metaItem">
                        <span className="metaLabel">Proceso activo</span>
                        <span className="metaValue">
                          {interactionLocked
                            ? "Backend"
                            : status.mode === "iteration"
                              ? "Validación"
                              : currentIteration > 1
                                ? "Iteración"
                                : "Borrador"}
                        </span>
                      </div>
                      <div className="metaItem">
                        <span className="metaLabel">Tiempo en fase</span>
                        <span className="metaValue">{formatDuration(liveElapsedSec)}</span>
                      </div>
                    </div>

                    <div className={`learningBanner ${resultBanner.tone}`}>
                      <div className="learningBannerTitle">{resultBanner.title}</div>
                      <div className="learningBannerText">{resultBanner.text}</div>
                    </div>

                    <div className="historyBox">
                      <div className="historyTitle">Historial del radicado</div>
                      <div className="historyList">
                        {result.iterations.map((item) => (
                          <div
                            key={item.iteration}
                            className={`historyItem ${item.iteration === currentIteration ? "current" : ""}`}
                          >
                            <div className="historyIteration">Iteración {item.iteration}</div>
                            <div className="historyMeta">
                              <span>{item.status}</span>
                              <span>
                                {item.feedback_uploaded
                                  ? `${item.comments_count} comentario(s)`
                                  : "Sin feedback"}
                              </span>
                              <span>{item.maintenance_status || "sin maintenance"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <details className="debugBox">
                      <summary>Detalle técnico del caso</summary>
                      <pre className="pre">{JSON.stringify(result, null, 2)}</pre>
                    </details>
                  </div>

                  <div className="resultActions">
                    <div className="actionPanel">
                      <div className="actionPanelTitle">Descargas</div>
                      <div className="actionGrid compact">
                        {docxUrl && (
                          <a className="downloadBtn" href={docxUrl} target="_blank" rel="noreferrer">
                            Descargar Word
                          </a>
                        )}
                        {pdfUrl && (
                          <a className="downloadBtn" href={pdfUrl} target="_blank" rel="noreferrer">
                            Descargar PDF
                          </a>
                        )}
                        {changeReportUrl && (
                          <a className="downloadBtn" href={changeReportUrl} target="_blank" rel="noreferrer">
                            Descargar reporte de cambios
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="actionPanel accent">
                      <div className="actionPanelTitle">Mejora del sistema</div>
                      <div className="feedbackFileName">
                        {feedbackFile
                          ? `Word revisado seleccionado: ${feedbackFile.name}`
                          : feedbackUploaded
                            ? maintenancePending
                              ? "El feedback ya fue enviado. Todo queda bloqueado hasta que termine la actualización automática del backend."
                              : "El feedback ya fue enviado. Usa Generar nueva iteración para seguir probando este mismo radicado."
                            : "Selecciona el Word revisado con comentarios del mismo caso para activar la mejora del sistema."}
                      </div>

                      <div className="actionGrid compact">
                        <label className="secondaryBtn">
                          <input
                            key={`feedback-${pickerVersion}`}
                            className="hiddenInput"
                            type="file"
                            accept=".docx"
                            onChange={onPickFeedback}
                            disabled={!canUploadFeedback || isUploadingFeedback || isRunningNext || interactionLocked}
                          />
                          Elegir Word revisado
                        </label>

                        <button
                          className="secondaryBtn"
                          type="button"
                          disabled={!feedbackFile || isUploadingFeedback || isRunningNext || interactionLocked}
                          onClick={onUploadFeedback}
                        >
                          {isUploadingFeedback ? "Enviando..." : "Enviar revisión"}
                        </button>

                        <button
                          className="primaryBtn compactBtn actionPrimary"
                          type="button"
                          disabled={!canRunNextIteration || isUploadingFeedback || isRunningNext}
                          onClick={onNextIteration}
                        >
                          {isRunningNext
                            ? "Iterando..."
                            : interactionLocked
                              ? "Esperando actualización del backend"
                              : "Generar nueva iteración"}
                        </button>
                      </div>
                    </div>

                    <div className="actionPanel logPanel">
                      <div className="actionPanelTitle">Registro en tiempo real</div>
                      <div className="logList">
                        {eventLog.map((entry) => (
                          <div key={entry.id} className={`logItem ${entry.tone}`}>
                            <div className="logHeader">
                              <span className="logTitle">{entry.title}</span>
                              <span className="logTime">{entry.at}</span>
                            </div>
                            <div className="logDetail">{entry.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="emptyResult">
                <div className="emptyResultEyebrow">Panel del caso</div>
                <div className="emptyResultTitle">
                  Aquí aparecerán el radicado, las descargas, el flujo de mejora y el registro en vivo.
                </div>
                <div className="emptyResultText">
                  Genera primero un borrador. Después podrás descargar artefactos,
                  subir el Word revisado y validar nuevas iteraciones sin perder el
                  contexto del mismo caso.
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
