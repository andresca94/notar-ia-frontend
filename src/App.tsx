import React, { useMemo, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TEMPLATE_ID = "1ViQYMPmpYOs4Xe1h6A9WKT3jARYX1oapWf0Ge44uVdk";

type StatusState = "idle" | "loading" | "success" | "error";

interface ArtifactLinks {
  docx_url: string;
  pdf_url: string;
}

interface TemplateUsage {
  acto_nombre: string;
  rag_query?: string | null;
  template_file?: string | null;
}

interface CaseResponse {
  ok: boolean;
  radicado: string;
  status: string;
  artifacts: ArtifactLinks;
  template_id?: string | null;
  templates_used?: TemplateUsage[];
  download_url?: string | null;
}

interface StatusMessage {
  state: StatusState;
  msg: string;
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

function formatTemplateLabel(value?: string | null): string {
  const normalized = (value || "").trim();
  return normalized || "Sin plantilla detectada";
}

function LoadingCard(props: { uploadPct: number }) {
  const { uploadPct } = props;
  const detail =
    uploadPct > 0 && uploadPct < 100
      ? "Subiendo archivos del caso…"
      : "Procesando documentos y construyendo el borrador.";

  return (
    <div className="loadingCard">
      <div className="phaseEyebrow">Proceso actual</div>
      <div className="loadingLabel">Generando borrador</div>

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
  const [pickerVersion, setPickerVersion] = useState(0);
  const [comentario, setComentario] = useState("");
  const [status, setStatus] = useState<StatusMessage>({ state: "idle", msg: "" });
  const [result, setResult] = useState<CaseResponse | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  const canSubmit = useMemo(() => docsFiles.length > 0, [docsFiles]);
  const templatesUsed = result?.templates_used || [];
  const docxUrl = resolveUrl(result?.artifacts?.docx_url);
  const pdfUrl = resolveUrl(result?.artifacts?.pdf_url);

  function onPickCedula(event: React.ChangeEvent<HTMLInputElement>) {
    setCedulaFiles(Array.from(event.target.files || []));
  }

  function onPickDocs(event: React.ChangeEvent<HTMLInputElement>) {
    setDocsFiles(Array.from(event.target.files || []));
  }

  function onResetCase() {
    setCedulaFiles([]);
    setDocsFiles([]);
    setComentario("");
    setStatus({ state: "idle", msg: "" });
    setResult(null);
    setUploadPct(0);
    setPickerVersion((value) => value + 1);
  }

  function removeCedula(index: number) {
    setCedulaFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function removeDoc(index: number) {
    setDocsFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function onSubmit() {
    setResult(null);
    setUploadPct(0);

    if (!canSubmit) {
      setStatus({
        state: "error",
        msg: "Faltan documentos base. Debes subir al menos un documento.",
      });
      return;
    }

    try {
      setStatus({
        state: "loading",
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
        msg: "Borrador generado.",
      });
    } catch (err) {
      setStatus({
        state: "error",
        msg: getErrorMessage(err, "No fue posible generar el borrador."),
      });
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">Notar-IA</h1>

        <div className="guidePanel">
          <div className="guideHeader">
            <div>
              <div className="guideEyebrow">Versión Alpha</div>
              <div className="guideTitle">Generación de borradores notariales</div>
            </div>
          </div>

          <div className="guideGrid">
            <div className="guideCard">
              <div className="guideCardTitle">1. Sube los soportes</div>
              <div className="guideText">
                Carga escaneos de identidad y documentos del caso. El sistema generará un
                borrador único listo para revisión.
              </div>
            </div>

            <div className="guideCard accent">
              <div className="guideCardTitle">2. Revisa y descarga</div>
              <div className="guideText">
                Verás el radicado detectado, la plantilla usada por acto y las descargas de
                Word y PDF.
              </div>
            </div>
          </div>
        </div>

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
                  disabled={status.state === "loading"}
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
                  disabled={status.state === "loading"}
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
                          disabled={status.state === "loading"}
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
                          disabled={status.state === "loading"}
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
                disabled={status.state === "loading"}
              />
            </div>

            {!result && (
              <button
                className="primaryBtn"
                disabled={!canSubmit || status.state === "loading"}
                onClick={onSubmit}
              >
                {status.state === "loading" ? "Procesando..." : "Generar borrador"}
              </button>
            )}

            {status.state === "loading" && <LoadingCard uploadPct={uploadPct} />}

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
                    <div className="resultTitle">Caso {result.radicado}</div>
                    <div className="resultSubtitle">
                      Borrador listo para revisión y descarga.
                    </div>
                    {(templatesUsed.length > 0 || result.template_id) && (
                      <div className="resultMeta">
                        {templatesUsed.length > 0 ? (
                          templatesUsed.map((item, index) => (
                            <div
                              key={`${item.acto_nombre}-${item.template_file}-${index}`}
                              className="resultMetaRow"
                            >
                              <span className="resultMetaLabel">
                                {item.acto_nombre || `Acto ${index + 1}`}:
                              </span>
                              <span className="resultMetaValue">
                                {formatTemplateLabel(item.template_file)}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="resultMetaRow">
                            <span className="resultMetaLabel">Plantilla base:</span>
                            <span className="resultMetaValue">
                              {formatTemplateLabel(result.template_id)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="secondaryBtn resultResetBtn"
                    type="button"
                    onClick={onResetCase}
                    disabled={status.state === "loading"}
                  >
                    Empezar otro caso
                  </button>
                </div>

                <div className="resultLayout">
                  <div className="resultPanel resultPanelStatus">
                    <div className="learningBanner ready">
                      <div className="learningBannerTitle">Borrador listo</div>
                      <div className="learningBannerText">
                        Revisa las plantillas utilizadas y descarga el Word o el PDF del caso.
                      </div>
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
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="emptyResult">
                <div className="emptyResultEyebrow">Panel del caso</div>
                <div className="emptyResultTitle">Aquí aparecerá el borrador generado.</div>
                <div className="emptyResultText">
                  Cuando generes el caso verás aquí el radicado detectado, la plantilla usada
                  y las descargas disponibles.
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
