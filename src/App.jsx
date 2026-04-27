import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TEMPLATE_ID = "1ViQYMPmpYOs4Xe1h6A9WKT3jARYX1oapWf0Ge44uVdk";
const BACKEND_UPDATE_WAIT_SECONDS = 180;

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
  return (
    err?.response?.data?.detail ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

  const [comentario, setComentario] = useState("");
  const [status, setStatus] = useState({ state: "idle", msg: "" });
  const [result, setResult] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [isUploadingFeedback, setIsUploadingFeedback] = useState(false);
  const [isRunningNext, setIsRunningNext] = useState(false);
  const [backendUpdateUntil, setBackendUpdateUntil] = useState(null);
  const [backendUpdateRemaining, setBackendUpdateRemaining] = useState(0);
  const [skipRecommendedWait, setSkipRecommendedWait] = useState(false);

  const canSubmit = useMemo(() => docsFiles.length > 0, [docsFiles]);
  const feedbackUploaded = Boolean(result?.feedback?.uploaded);
  const canUploadFeedback = Boolean(result?.actions?.feedback_upload_url);
  const waitRecommended = Boolean(
    feedbackUploaded && backendUpdateRemaining > 0 && !skipRecommendedWait
  );
  const canRunNextIteration = Boolean(
    result?.actions?.next_iteration_url && feedbackUploaded && !waitRecommended
  );
  const workflowMode = feedbackUploaded ? "learning" : result ? "drafted" : "start";

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
    if (!backendUpdateUntil) {
      setBackendUpdateRemaining(0);
      return undefined;
    }

    const refreshCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((backendUpdateUntil - Date.now()) / 1000)
      );
      setBackendUpdateRemaining(remaining);
    };

    refreshCountdown();
    const timer = setInterval(refreshCountdown, 1000);
    return () => clearInterval(timer);
  }, [backendUpdateUntil]);

  useEffect(() => {
    if (!feedbackUploaded) {
      setBackendUpdateUntil(null);
      setBackendUpdateRemaining(0);
      setSkipRecommendedWait(false);
    }
  }, [feedbackUploaded, result?.current_iteration]);

  function onPickCedula(event) {
    setCedulaFiles(Array.from(event.target.files || []));
  }

  function onPickDocs(event) {
    setDocsFiles(Array.from(event.target.files || []));
  }

  function onPickFeedback(event) {
    const file = event.target.files?.[0] || null;
    setFeedbackFile(file);
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

    try {
      setIsUploadingFeedback(true);
      setStatus({ state: "idle", msg: "" });
      const form = new FormData();
      form.append("feedback_docx", feedbackFile);

      const response = await axios.post(resolveUrl(result.actions.feedback_upload_url), form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const waitUntil = Date.now() + BACKEND_UPDATE_WAIT_SECONDS * 1000;
      setBackendUpdateUntil(waitUntil);
      setBackendUpdateRemaining(BACKEND_UPDATE_WAIT_SECONDS);
      setSkipRecommendedWait(false);
      setResult(response.data);
      setFeedbackFile(null);
      setStatus({
        state: "success",
        msg: "Feedback cargado. Codex está actualizando el backend con esta revisión; espera unos minutos antes de generar la siguiente iteración.",
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
        msg: "Sube y envía primero el feedback del Word revisado.",
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
      setBackendUpdateUntil(null);
      setBackendUpdateRemaining(0);
      setSkipRecommendedWait(false);
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
  const learningBannerText = waitRecommended
    ? `El backend se está actualizando con este feedback. Espera ${formatCountdown(
        backendUpdateRemaining
      )} antes de generar la siguiente iteración para probar una mejora del sistema.`
    : feedbackUploaded
      ? "La espera recomendada terminó. Ya puedes generar la siguiente iteración para comprobar si la mejora del sistema quedó aplicada."
      : "Si este borrador ya sirve, puedes descargarlo y seguir. Si quieres ayudar a mejorar el sistema, sube el Word revisado con comentarios.";

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
              {workflowMode === "learning"
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
                <li>Espera unos minutos mientras el backend se actualiza.</li>
                <li>Genera la siguiente iteración para probar la mejora.</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="pickerGrid">
          <label className="bigPicker">
            <input
              className="hiddenInput"
              type="file"
              multiple
              accept=".pdf,image/*"
              onChange={onPickCedula}
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
              className="hiddenInput"
              type="file"
              multiple
              accept=".pdf,image/*"
              onChange={onPickDocs}
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
          />
        </div>

        <button
          className="primaryBtn"
          disabled={!canSubmit || status.state === "loading"}
          onClick={onSubmit}
        >
          {status.state === "loading" ? "Procesando..." : "Generar"}
        </button>

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

          <div className={`learningBanner ${waitRecommended ? "pending" : "ready"}`}>
            <div className="learningBannerTitle">
              {waitRecommended
                ? "Backend actualizándose"
                : feedbackUploaded
                  ? "Backend listo para reintentar"
                  : "Siguiente decisión"}
            </div>
            <div className="learningBannerText">{learningBannerText}</div>
            {waitRecommended && (
              <div className="countdownRow">
                <span className="countdownPill">
                  Espera recomendada: {formatCountdown(backendUpdateRemaining)}
                </span>
                <button
                  className="secondaryBtn inlineBtn"
                  type="button"
                  onClick={() => setSkipRecommendedWait(true)}
                >
                  Generar ahora de todos modos
                </button>
              </div>
            )}
          </div>

            <div className="actionGrid">
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

              <label className="secondaryBtn">
                <input
                  className="hiddenInput"
                  type="file"
                  accept=".docx"
                  onChange={onPickFeedback}
                  disabled={!canUploadFeedback || isUploadingFeedback || isRunningNext}
                />
                Seleccionar Word revisado
              </label>

              <button
                className="secondaryBtn"
                type="button"
                disabled={!feedbackFile || isUploadingFeedback || isRunningNext}
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
                  : waitRecommended
                    ? `Disponible en ${formatCountdown(backendUpdateRemaining)}`
                    : "Generar siguiente iteración"}
              </button>
            </div>

            <div className="feedbackFileName">
              {feedbackFile
                ? `Word revisado seleccionado: ${feedbackFile.name}`
                : feedbackUploaded
                  ? "El feedback ya fue enviado. Espera unos minutos y luego genera la siguiente iteración."
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
