import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TEMPLATE_ID = "1ViQYMPmpYOs4Xe1h6A9WKT3jARYX1oapWf0Ge44uVdk";

type StatusMode = "idle" | "generation" | "feedback" | "maintenance" | "iteration";
type StatusState = "idle" | "loading" | "success" | "error";
type WorkflowMode =
  | "start"
  | "processing"
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

interface ActivePhaseInfo {
  label: string;
  detail: string;
  tone: "draft" | "feedback" | "backend" | "validation";
}

function createEventId(): string {
  const maybeCrypto = globalThis.crypto as Crypto | undefined;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function describeIteration(iteration: number): string {
  if (iteration <= 1) {
    return "Esta es la primera versión de este radicado.";
  }
  return `Esta es la iteración ${iteration} del mismo radicado. Usa Empezar otro caso si quieres reiniciar la prueba desde cero.`;
}

function getWorkflowMode(params: {
  interactionLocked: boolean;
  maintenanceCompleted: boolean;
  maintenanceSkipped: boolean;
  maintenanceFailed: boolean;
  feedbackUploaded: boolean;
  hasResult: boolean;
  resultStatus?: string;
  statusState: StatusState;
  statusMode: StatusMode;
}): WorkflowMode {
  const {
    interactionLocked,
    maintenanceCompleted,
    maintenanceSkipped,
    maintenanceFailed,
    feedbackUploaded,
    hasResult,
    resultStatus,
    statusState,
    statusMode,
  } = params;

  if (statusState === "loading" && statusMode === "generation") return "processing";
  if (interactionLocked) return "locked";
  if (maintenanceFailed) return "attention";
  if (maintenanceCompleted) return "validation";
  if (maintenanceSkipped) return "iterating";
  if (feedbackUploaded) return "feedback";
  if (resultStatus === "generated") return "drafted";
  if (hasResult) return "drafted";
  return "start";
}

function getWorkflowBadge(mode: WorkflowMode): string {
  switch (mode) {
    case "processing":
      return "Generando borrador";
    case "locked":
      return "Backend actualizándose";
    case "validation":
      return "Listo para validar";
    case "iterating":
      return "Listo para iterar";
    case "attention":
      return "Revisión manual";
    case "feedback":
      return "Feedback cargado";
    case "drafted":
      return "Borrador listo";
    default:
      return "Preparar caso";
  }
}

function getLoadingConfig(
  mode: StatusMode,
  uploadPct: number,
): { label: string; detail: string } {
  switch (mode) {
    case "feedback":
      return {
        label: "Registrando feedback",
        detail: "Leyendo y asociando el Word revisado al radicado actual.",
      };
    case "maintenance":
      return {
        label: "Actualizando backend",
        detail: "Codex está intentando aplicar una mejora global del sistema.",
      };
    case "iteration":
      return {
        label: "Generando iteración",
        detail: "Se está regenerando este mismo caso para validar el resultado.",
      };
    default:
      return {
        label: "Generando borrador",
        detail:
          uploadPct > 0 && uploadPct < 100
            ? "Subiendo archivos del caso…"
            : "Procesando documentos y plantilla del caso.",
      };
  }
}

function getMaintenanceDisplay(status: string | null): BannerInfo | null {
  switch (status) {
    case "queued":
    case "running":
      return {
        tone: "pending",
        title: "Backend actualizándose",
        text: "Codex está intentando aplicar una mejora global del sistema con este feedback.",
      };
    case "completed":
      return {
        tone: "ready",
        title: "Backend actualizado",
        text: "La mejora global quedó aplicada. Ahora puedes generar la siguiente iteración.",
      };
    case "skipped":
      return {
        tone: "neutral",
        title: "Sin cambio global",
        text: "Con este feedback no se aplicó una mejora global. Puedes seguir validando el mismo caso.",
      };
    case "failed":
      return {
        tone: "danger",
        title: "Actualización no completada",
        text: "La actualización automática no se completó. Puedes reintentar con otro feedback o seguir con el caso.",
      };
    default:
      return null;
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

  const maintenanceDisplay = getMaintenanceDisplay(maintenance?.status || null);
  if (maintenanceDisplay && (maintenancePending || maintenanceCompleted || maintenanceSkipped || maintenanceFailed)) {
    return maintenanceDisplay;
  }
  if (feedbackUploaded) {
    return {
      tone: "neutral",
      title: "Feedback registrado",
      text: "El Word revisado ya quedó asociado a este caso. Cuando se habilite, genera otra iteración.",
    };
  }
  if (currentIteration > 1) {
    return {
      tone: "ready",
      title: "Nueva iteración lista",
      text: "Esta versión ya refleja un nuevo intento del mismo radicado. Compárala con la anterior y descarga el reporte de cambios.",
    };
  }
  return {
    tone: "ready",
    title: "Borrador listo",
    text: "Descarga Word o PDF si ya está bien. Si quieres mejorar el sistema, sube el Word revisado con comentarios.",
  };
}

function LoadingCard(props: {
  mode: StatusMode;
  uploadPct: number;
}) {
  const { mode, uploadPct } = props;
  const { label, detail } = getLoadingConfig(mode, uploadPct);

  return (
    <div className="loadingCard">
      <div className="phaseEyebrow">Proceso actual</div>
      <div className="loadingLabel">{label}</div>

      <div className="spinnerWrap">
        <div className="spinner" />
        <div className="spinnerCopy">
          <div className="spinnerText">{detail}</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
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
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

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
    hasResult: Boolean(result),
    resultStatus: result?.status,
    statusState: status.state,
    statusMode: status.mode,
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

  const docxUrl = resolveUrl(result?.artifacts?.docx_url);
  const pdfUrl = resolveUrl(result?.artifacts?.pdf_url);
  const changeReportUrl = resolveUrl(result?.artifacts?.change_report_url);
  const showChangeReport = Boolean(changeReportUrl && !interactionLocked);
  const activePhase = useMemo<ActivePhaseInfo | null>(() => {
    if (status.state === "loading") {
      if (status.mode === "generation") {
        return {
          label: "Borrador",
          detail: "Se está generando el borrador inicial del caso.",
          tone: "draft",
        };
      }
      if (status.mode === "feedback") {
        return {
          label: "Feedback",
          detail: "Se está registrando el Word revisado de este caso.",
          tone: "feedback",
        };
      }
      if (status.mode === "maintenance") {
        return {
          label: "Backend",
          detail: "Codex está intentando aplicar una mejora global del backend.",
          tone: "backend",
        };
      }
      if (status.mode === "iteration") {
        return {
          label: "Validación",
          detail: "Se está generando una nueva iteración para validar el resultado.",
          tone: "validation",
        };
      }
    }

    if (globalMaintenancePending) {
      return {
        label: "Backend",
        detail: "Hay una actualización global del backend en curso. La interfaz sigue bloqueada hasta que termine.",
        tone: "backend",
      };
    }

    return null;
  }, [
    globalMaintenance,
    globalMaintenancePending,
    maintenance?.message,
    status.mode,
    status.state,
  ]);

  function onDownloadDebug() {
    if (!result) return;
    const payload = {
      exported_at: new Date().toISOString(),
      endpoint: `${API_BASE}/notaria-v63-universal`,
      template_id: TEMPLATE_ID,
      global_maintenance: globalMaintenance,
      case: result,
      recent_events: eventLog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `debug_caso_${result.radicado}_iteracion_${result.current_iteration}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function appendLog(title: string, detail: string, tone: EventTone = "info") {
    setEventLog((current) => [
      {
        id: createEventId(),
        at: formatClock(),
        title,
        detail,
        tone,
      },
      ...current,
    ].slice(0, 4));
  }

  useEffect(() => {
    if (!status.msg || status.state === "loading") return;
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
      ? `${globalMaintenance.status}|${globalMaintenance.radicado}|${globalMaintenance.iteration}`
      : "none";
    if (key === lastMaintenanceKeyRef.current) return;
    lastMaintenanceKeyRef.current = key;

    if (!globalMaintenance) {
      return;
    }

    const display = getMaintenanceDisplay(globalMaintenance.status);
    if (!display) return;
    appendLog(
      display.title,
      display.text,
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
      "Caso actualizado",
      `Radicado ${result.radicado} en iteración ${result.current_iteration}.`,
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
      const display = getMaintenanceDisplay(maintenance?.status || null);
      setStatus({
        state: "loading",
        mode: "maintenance",
        msg: display?.text || "El backend se está actualizando con este feedback.",
      });
      return;
    }

    if (maintenanceCompleted) {
      const display = getMaintenanceDisplay(maintenance?.status || null);
      setStatus({
        state: "success",
        mode: "idle",
        msg: display?.text || "Backend actualizado. Ya puedes generar la siguiente iteración.",
      });
      return;
    }

    if (maintenanceSkipped) {
      const display = getMaintenanceDisplay(maintenance?.status || null);
      setStatus({
        state: "success",
        mode: "idle",
        msg:
          display?.text ||
          "No se aplicó un cambio global automático. Ya puedes generar la siguiente iteración para validar solo este caso.",
      });
      return;
    }

    if (maintenanceFailed) {
      const display = getMaintenanceDisplay(maintenance?.status || null);
      setStatus({
        state: "error",
        mode: "idle",
        msg:
          display?.text ||
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
        msg: `Ese Word parece pertenecer al radicado ${hintedCase}. Carga ese caso para seguir con este archivo.`,
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
    setPickerVersion((value) => value + 1);
    setEventLog([]);
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
        msg: "Generando borrador…",
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
        msg: "Borrador generado.",
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
      setStatus({
        state: "loading",
        mode: "feedback",
        msg: "Registrando feedback…",
      });

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
        msg: "Feedback cargado. La interfaz quedará bloqueada hasta terminar la actualización.",
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

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">Notar-IA</h1>

        <div className="guidePanel">
          <div className="guideHeader">
            <div>
              <div className="guideEyebrow">Modo de uso</div>
              <div className="guideTitle">Uso rápido o mejora del sistema</div>
            </div>
            <div className={`guideBadge ${workflowMode}`}>{getWorkflowBadge(workflowMode)}</div>
          </div>

          <div className="guideGrid">
            <div className="guideCard">
              <div className="guideCardTitle">Sin feedback</div>
              <div className="guideText">Genera el borrador y descarga Word o PDF si ya quedó bien.</div>
            </div>

            <div className="guideCard accent">
              <div className="guideCardTitle">Con feedback</div>
              <div className="guideText">Sube el Word revisado, espera el backend y luego genera otra iteración.</div>
            </div>
          </div>

        </div>

        {status.state !== "loading" && activePhase && (
          <div className={`phaseCard ${activePhase.tone}`}>
            <div className="phaseEyebrow">Proceso actual</div>
            <div className="phaseTitle">{activePhase.label}</div>
            <div className="phaseText">{activePhase.detail}</div>
          </div>
        )}

        <div className="workspaceGrid">
          <section className="workspaceColumn inputColumn">
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
                uploadPct={uploadPct}
              />
            )}

            {status.state !== "idle" && status.state !== "loading" && (
              <div className={`status ${status.state}`}>{status.msg}</div>
            )}

            {!result && (
              <div className="hint">
                <b>Requisito:</b> sube al menos 1 documento base para generar el borrador.
              </div>
            )}
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
                  <div className="resultPanel resultPanelStatus">
                    <div className={`learningBanner ${resultBanner.tone}`}>
                      <div className="learningBannerTitle">{resultBanner.title}</div>
                      <div className="learningBannerText">{resultBanner.text}</div>
                    </div>
                  </div>

                  <div className="actionPanel resultPanel">
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
                      {showChangeReport && (
                        <a className="downloadBtn" href={changeReportUrl} target="_blank" rel="noreferrer">
                          Descargar reporte de cambios
                        </a>
                      )}
                      <button className="secondaryBtn" type="button" onClick={onDownloadDebug}>
                        Descargar debug
                      </button>
                    </div>
                  </div>

                  <div className="actionPanel accent resultPanel">
                    <div className="actionPanelTitle">Mejora del sistema</div>
                    <div className="feedbackFileName">
                      {feedbackFile
                        ? `Archivo seleccionado: ${feedbackFile.name}`
                        : feedbackUploaded
                          ? maintenancePending
                            ? "Feedback enviado. Esperando que termine la actualización del backend."
                            : "Feedback cargado. Cuando quieras, genera otra iteración."
                          : "Selecciona el Word revisado de este mismo caso."}
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
                        Elegir Word
                      </label>

                      <button
                        className="secondaryBtn"
                        type="button"
                        disabled={!feedbackFile || isUploadingFeedback || isRunningNext || interactionLocked}
                        onClick={onUploadFeedback}
                      >
                        {isUploadingFeedback ? "Enviando..." : "Enviar feedback"}
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
                            : "Generar iteración"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="emptyResult">
                <div className="emptyResultEyebrow">Panel del caso</div>
                <div className="emptyResultTitle">Aquí aparecerá el caso activo.</div>
                <div className="emptyResultText">
                  Cuando generes el borrador verás aquí el radicado, las descargas,
                  la mejora del sistema y el registro en tiempo real.
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
