import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TEMPLATE_ID = "1ViQYMPmpYOs4Xe1h6A9WKT3jARYX1oapWf0Ge44uVdk";

function resolveUrl(path) {
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

function getErrorMessage(err, fallback) {
  if (err?.response?.status === 502) {
    return "El backend sigue reiniciandose o actualizandose. Espera 1 o 2 minutos y vuelve a intentar.";
  }
  return (
    err?.response?.data?.detail ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}

function extractCaseHintFromFilename(filename) {
  const match = (filename || "").match(/(?:caso|radicado)[\s_-]*(\d{4,})/i);
  return match ? match[1] : null;
}

export default function App() {
  const LOADING_MESSAGES = [
    "Subiendo archivos…",
    "Analizando radicación…",
    "Leyendo soportes…",
    "Extrayendo datos de cédulas…",
    "Generando minuta…",
    "Armando escritura acto por acto…",
    "Exportando a PDF…",
    "Casi listo…",
  ];

  const [loadingStep, setLoadingStep] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [cedulaFiles, setCedulaFiles] = useState([]);
  const [docsFiles, setDocsFiles] = useState([]);
  const [feedbackFile, setFeedbackFile] = useState(null);
  const [pickerVersion, setPickerVersion] = useState(0);

  const [comentario, setComentario] = useState("");
  const [status, setStatus] = useState({ state: "idle", msg: "" });
  const [result, setResult] = useState(null);
  const [globalMaintenance, setGlobalMaintenance] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [isUploadingFeedback, setIsUploadingFeedback] = useState(false);
  const [isRunningNext, setIsRunningNext] = useState(false);

  const canSubmit = useMemo(() => docsFiles.length > 0, [docsFiles]);
  const feedbackUploaded = Boolean(result?.feedback?.uploaded);
  const canUploadFeedback = Boolean(result?.actions?.feedback_upload_url);
  const maintenance = result?.maintenance || null;
  const maintenanceStatus = maintenance?.status || null;
  const globalMaintenanceStatus = globalMaintenance?.status || null;
  const globalMaintenancePending = Boolean(
    ["queued", "running"].includes(globalMaintenanceStatus)
  );
  const maintenancePending = Boolean(
    feedbackUploaded && ["queued", "running"].includes(maintenanceStatus)
  );
  const maintenanceFailed = maintenanceStatus === "failed";
  const maintenanceCompleted = maintenanceStatus === "completed";
  const maintenanceSkipped = maintenanceStatus === "skipped";
  const interactionLocked = maintenancePending || globalMaintenancePending;
  const canRunNextIteration = Boolean(
    result?.actions?.next_iteration_url && feedbackUploaded && !interactionLocked
  );
  const workflowMode = interactionLocked ? "locked" : feedbackUploaded ? "learning" : result ? "drafted" : "start";

  useEffect(() => {
    if (status.state !== "loading") {
      setLoadingStep(0);
      setElapsedSec(0);
      return;
    }

    const t0 = Date.now();
    const msgTimer = setInterval(() => {
      setLoadingStep((step) => (step + 1) % LOADING_MESSAGES.length);
    }, 2500);
    const secTimer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);

    return () => {
      clearInterval(msgTimer);
      clearInterval(secTimer);
    };
  }, [status.state]);

  useEffect(() => {
    let cancelled = false;

    const refreshGlobalMaintenance = async () => {
      try {
        const response = await axios.get(resolveUrl("/maintenance/backend"));
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
    const timer = setInterval(refreshGlobalMaintenance, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!result?.actions?.case_url || !maintenancePending) {
      return undefined;
    }

    let cancelled = false;
    const refreshCase = async () => {
      try {
        const response = await axios.get(resolveUrl(result.actions.case_url));
        if (!cancelled) {
          setResult(response.data);
        }
      } catch (_err) {
        // While the backend is redeploying, transient errors are expected.
      }
    };

    refreshCase();
    const timer = setInterval(refreshCase, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [maintenancePending, result?.actions?.case_url]);

  useEffect(() => {
    if (!feedbackUploaded) {
      return;
    }
    if (maintenancePending) {
      setStatus({
        state: "loading",
        msg: maintenance?.message || "El backend se está actualizando con este feedback.",
      });
      return;
    }
    if (maintenanceCompleted) {
      setStatus({
        state: "success",
        msg: maintenance?.message || "Backend actualizado. Ya puedes generar la siguiente iteración.",
      });
      return;
    }
    if (maintenanceSkipped) {
      setStatus({
        state: "success",
        msg:
          maintenance?.message ||
          "No se aplicó un cambio global automático. Ya puedes generar la siguiente iteración para validar solo el feedback de este caso.",
      });
      return;
    }
    if (maintenanceFailed) {
      setStatus({
        state: "error",
        msg:
          maintenance?.message ||
          "La actualización automática del backend falló. Puedes continuar, pero esta iteración ya no valida una mejora global aplicada.",
      });
    }
  }, [feedbackUploaded, maintenance, maintenanceCompleted, maintenanceFailed, maintenancePending, maintenanceSkipped]);

  function onPickCedula(event) {
    setCedulaFiles(Array.from(event.target.files || []));
  }

  function onPickDocs(event) {
    setDocsFiles(Array.from(event.target.files || []));
  }

  function onPickFeedback(event) {
    const file = event.target.files?.[0] || null;
    const hintedCase = extractCaseHintFromFilename(file?.name || "");
    if (file && result?.radicado && hintedCase && hintedCase !== String(result.radicado)) {
      setFeedbackFile(null);
      setStatus({
        state: "error",
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
    setStatus({ state: "idle", msg: "" });
    setResult(null);
    setUploadPct(0);
    setLoadingStep(0);
    setElapsedSec(0);
    setPickerVersion((value) => value + 1);
  }

  function removeCedula(index) {
    setCedulaFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeDoc(index) {
    setDocsFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit() {
    setResult(null);
    setFeedbackFile(null);
    setUploadPct(0);
    setLoadingStep(0);
    setElapsedSec(0);

    if (!canSubmit) {
      setStatus({ state: "error", msg: "Faltan documentos (mínimo 1)." });
      return;
    }
    if (globalMaintenancePending) {
      setStatus({
        state: "error",
        msg:
          globalMaintenance?.message ||
          "El backend está actualizándose con feedback experto. Espera a que termine antes de generar un nuevo caso.",
      });
      return;
    }

    try {
      setStatus({ state: "loading", msg: "Generando primera iteración..." });

      const form = new FormData();
      for (const file of cedulaFiles) {
        form.append("cedula", file);
      }
      for (const file of docsFiles) {
        form.append("documentos", file);
      }
      if ((comentario || "").trim()) {
        form.append("comentario", comentario);
      }
      form.append("template_id", TEMPLATE_ID);

      const response = await axios.post(`${API_BASE}/notaria-v63-universal`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          setUploadPct(Math.round((evt.loaded * 100) / evt.total));
        },
      });

      setResult(response.data);
      setStatus({ state: "success", msg: "Primera iteración generada." });
    } catch (err) {
      setStatus({
        state: "error",
        msg: String(getErrorMessage(err, "Error enviando request.")),
      });
    }
  }

  async function onUploadFeedback() {
    if (!feedbackFile || !canUploadFeedback) {
      setStatus({
        state: "error",
        msg: "Selecciona primero el DOCX con comentarios de Word.",
      });
      return;
    }
    if (interactionLocked) {
      setStatus({
        state: "error",
        msg:
          maintenance?.message ||
          globalMaintenance?.message ||
          "El backend sigue actualizándose. Espera a que termine antes de enviar otro feedback.",
      });
      return;
    }

    try {
      setIsUploadingFeedback(true);
      setStatus({ state: "idle", msg: "" });
      const form = new FormData();
      form.append("feedback_docx", feedbackFile);

      const response = await axios.post(resolveUrl(result.actions.feedback_upload_url), form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(response.data);
      setFeedbackFile(null);
      setStatus({
        state: "loading",
        msg: "Feedback cargado. Codex está actualizando el backend con esta revisión; esta pantalla se desbloqueará automáticamente cuando termine.",
      });
    } catch (err) {
      setStatus({
        state: "error",
        msg: String(getErrorMessage(err, "No fue posible subir el feedback.")),
      });
    } finally {
      setIsUploadingFeedback(false);
    }
  }

  async function onNextIteration() {
    if (!canRunNextIteration) {
      setStatus({
        state: "error",
        msg:
          maintenancePending || globalMaintenancePending
            ? "El backend todavía se está actualizando. La siguiente iteración se desbloqueará cuando termine."
            : "Sube y envía primero el feedback del Word revisado.",
      });
      return;
    }

    try {
      setIsRunningNext(true);
      setUploadPct(0);
      setStatus({ state: "loading", msg: "Generando siguiente iteración..." });

      const response = await axios.post(resolveUrl(result.actions.next_iteration_url));
      setResult(response.data);
      setFeedbackFile(null);
      setStatus({
        state: "success",
        msg: `Iteración ${response.data.current_iteration} generada.`,
      });
    } catch (err) {
      setStatus({
        state: "error",
        msg: String(getErrorMessage(err, "No fue posible generar la siguiente iteración.")),
      });
    } finally {
      setIsRunningNext(false);
    }
  }

  const docxUrl = resolveUrl(result?.artifacts?.docx_url);
  const pdfUrl = resolveUrl(result?.artifacts?.pdf_url);
  const changeReportUrl = resolveUrl(result?.artifacts?.change_report_url);
  const learningBannerTone = maintenancePending ? "pending" : "ready";
  const learningBannerText = maintenancePending
    ? maintenance?.message ||
      "El backend se está actualizando con este feedback. La siguiente iteración se habilitará cuando termine."
    : maintenanceCompleted
      ? "La actualización del backend terminó. Ya puedes generar la siguiente iteración para probar si la mejora global quedó aplicada."
      : maintenanceSkipped
        ? maintenance?.message ||
          "No se aplicó un cambio global automático. Ya puedes generar la siguiente iteración para validar solo este caso."
      : maintenanceFailed
        ? `${maintenance?.message || "La actualización automática del backend falló."} Puedes continuar con la siguiente iteración, pero ya no estarás validando una mejora global aplicada con éxito.`
        : feedbackUploaded
          ? "El feedback ya quedó registrado. Usa Generar siguiente iteración para continuar este mismo caso."
          : "Si este borrador ya sirve, puedes descargarlo y seguir. Si quieres ayudar a mejorar el sistema, sube el Word revisado con comentarios.";
  const globalBannerText = globalMaintenancePending
    ? globalMaintenance?.message ||
      "El backend se está actualizando con feedback experto. Toda la interfaz queda bloqueada hasta que termine."
    : null;

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
            <div className={`guideBadge ${workflowMode}`}>
              {workflowMode === "locked"
                ? "Backend actualizándose"
                : workflowMode === "learning"
                ? "Aprendiendo del feedback"
                : workflowMode === "drafted"
                  ? "Borrador listo"
                  : "Listo para comenzar"}
            </div>
          </div>

          <div className="guideGrid">
            <div className="guideCard">
              <div className="guideCardTitle">Uso rápido</div>
              <ol className="guideList">
                <li>Sube escaneos y documentos.</li>
                <li>Genera un nuevo borrador.</li>
                <li>Descarga Word o PDF y continúa sin feedback si ya quedó bien.</li>
              </ol>
            </div>

            <div className="guideCard accent">
              <div className="guideCardTitle">Mejora del sistema</div>
              <ol className="guideList">
                <li>Genera un nuevo borrador.</li>
                <li>Sube el Word revisado con comentarios.</li>
                <li>Espera a que el backend termine de actualizarse.</li>
                <li>Genera la siguiente iteración para probar la mejora.</li>
              </ol>
            </div>
          </div>
        </div>

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
                  : "Sube cédula(s) o tarjeta de identidad"}
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
                  : "Sube documentos (múltiples)"}
              </div>
            </div>
          </label>
        </div>

        {cedulaFiles.length > 0 && (
          <div className="filesBox">
            <div className="filesHeader">Escaneos</div>
            <ul className="filesList">
              {cedulaFiles.map((file, idx) => (
                <li key={`${file.name}-${idx}`} className="fileRow">
                  <span className="fileName">{file.name}</span>
                  <button
                    className="linkBtn"
                    type="button"
                    onClick={() => removeCedula(idx)}
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
              {docsFiles.map((file, idx) => (
                <li key={`${file.name}-${idx}`} className="fileRow">
                  <span className="fileName">{file.name}</span>
                  <button
                    className="linkBtn"
                    type="button"
                    onClick={() => removeDoc(idx)}
                    disabled={interactionLocked}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label className="label">Comentario:</label>
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
                : "Generar"}
          </button>
        )}

        {status.state === "loading" && (
          <>
            {uploadPct > 0 && uploadPct < 100 && (
              <div className="progressWrap">
                <div className="progressBar">
                  <div className="progressFill" style={{ width: `${uploadPct}%` }} />
                </div>
                <div className="progressText">{uploadPct}%</div>
              </div>
            )}

            {(uploadPct === 0 || uploadPct >= 100) && (
              <div className="spinnerWrap">
                <div className="spinner" />
                <div className="spinnerText">
                  {LOADING_MESSAGES[loadingStep]} ({elapsedSec}s)
                </div>
              </div>
            )}
          </>
        )}

        {status.state !== "idle" && (
          <div className={`status ${status.state}`}>{status.msg}</div>
        )}

        {result && (
          <div className="resultBox">
            <div className="resultTitle">
              Caso {result.radicado} · Iteración {result.current_iteration}
            </div>

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
          </div>

          <div className={`learningBanner ${learningBannerTone}`}>
            <div className="learningBannerTitle">
              {maintenancePending
                ? "Backend actualizándose"
                : maintenanceCompleted
                  ? "Backend actualizado"
                  : maintenanceFailed
                    ? "Actualización automática fallida"
                    : feedbackUploaded
                      ? "Feedback registrado"
                  : "Siguiente decisión"}
            </div>
            <div className="learningBannerText">{learningBannerText}</div>
          </div>

            <div className="actionGrid">
              <button
                className="secondaryBtn"
                type="button"
                onClick={onResetCase}
                disabled={interactionLocked || isUploadingFeedback || isRunningNext}
              >
                Empezar otro caso
              </button>

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

              <label className="secondaryBtn">
                <input
                  key={`feedback-${pickerVersion}`}
                  className="hiddenInput"
                  type="file"
                  accept=".docx"
                  onChange={onPickFeedback}
                  disabled={!canUploadFeedback || isUploadingFeedback || isRunningNext || interactionLocked}
                />
                Seleccionar Word revisado
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
                className="primaryBtn compactBtn"
                type="button"
                disabled={!canRunNextIteration || isUploadingFeedback || isRunningNext}
                onClick={onNextIteration}
              >
                {isRunningNext
                  ? "Iterando..."
                  : interactionLocked
                    ? "Esperando actualización del backend"
                    : "Generar siguiente iteración"}
              </button>
            </div>

            <div className="feedbackFileName">
              {feedbackFile
                ? `Word revisado seleccionado: ${feedbackFile.name}`
                : feedbackUploaded
                  ? maintenancePending
                    ? "El feedback ya fue enviado. La siguiente iteración queda bloqueada hasta que termine la actualización automática del backend."
                    : "El feedback ya fue enviado. Usa Generar siguiente iteración; no uses Generar para este mismo caso."
                  : "Selecciona el Word revisado con comentarios para activar la mejora del sistema."}
            </div>

            <details className="debugBox">
              <summary>Detalle técnico del caso</summary>
              <pre className="pre">{JSON.stringify(result, null, 2)}</pre>
            </details>
          </div>
        )}

        <div className="hint">
          <div>
            <b>Requisito para enviar:</b> al menos 1 documento
          </div>
          <div className="small">
            Endpoint: <code>{API_BASE}/notaria-v63-universal</code>
          </div>
          <div className="small">
            template_id fijo: <code>{TEMPLATE_ID}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
