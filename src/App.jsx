import React, { useMemo, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// Template fijo
const TEMPLATE_ID = "1ViQYMPmpYOs4Xe1h6A9WKT3jARYX1oapWf0Ge44uVdk";

export default function App() {
  // cedula: Optional[List[UploadFile]] => permitir 0..N archivos
  const [cedulaFiles, setCedulaFiles] = useState([]);
  // documentos: List[UploadFile] => requerido, 1..N
  const [docsFiles, setDocsFiles] = useState([]);

  const [comentario, setComentario] = useState("");
  const [status, setStatus] = useState({ state: "idle", msg: "" });
  const [result, setResult] = useState(null);

  // progreso de subida (real)
  const [uploadPct, setUploadPct] = useState(0);

  const canSubmit = useMemo(() => {
    return docsFiles.length > 0;
  }, [docsFiles]);

  function onPickCedula(e) {
    const files = Array.from(e.target.files || []);
    setCedulaFiles(files);
  }

  function onPickDocs(e) {
    const files = Array.from(e.target.files || []);
    setDocsFiles(files);
  }

  function removeCedula(index) {
    setCedulaFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeDoc(index) {
    setDocsFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit() {
    setResult(null);
    setUploadPct(0);

    if (!canSubmit) {
      setStatus({ state: "error", msg: "Faltan documentos (mínimo 1)." });
      return;
    }

    try {
      setStatus({ state: "loading", msg: "Generando..." });

      const form = new FormData();

      // cedula: key repetida N veces (si hay)
      for (const f of cedulaFiles) {
        form.append("cedula", f);
      }

      // documentos: key repetida N veces
      for (const f of docsFiles) {
        form.append("documentos", f);
      }

      // comentario: tu backend tiene default "(Sin comentarios)"
      // Si quieres respetar el default del backend, NO lo envíes si está vacío.
      if ((comentario || "").trim().length > 0) {
        form.append("comentario", comentario);
      }

      // template_id opcional en backend, pero aquí lo mandamos fijo
      form.append("template_id", TEMPLATE_ID);

      const url = `${API_BASE}/notaria-v63-universal`;

      const res = await axios.post(url, form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          const pct = Math.round((evt.loaded * 100) / evt.total);
          setUploadPct(pct);
        },
      });

      setResult(res.data);
      setStatus({ state: "success", msg: "Listo ✅" });

      // ✅ Descarga/abre automáticamente el PDF generado
      const dl = res.data?.download_url;
      if (dl) {
        const full = dl.startsWith("http") ? dl : `${API_BASE}${dl}`;
        // abre en nueva pestaña (robusto)
        window.open(full, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        "Error enviando request.";
      setStatus({ state: "error", msg: String(msg) });
    }
  }

  const downloadUrl = result?.download_url
    ? result.download_url.startsWith("http")
      ? result.download_url
      : `${API_BASE}${result.download_url}`
    : null;

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">Notar-IA</h1>

        <div className="pickerGrid">
          {/* Escaneos (cedula opcional, múltiple) */}
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

          {/* Documentos (requerido, múltiple) */}
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

        {/* Lista cedulas */}
        {cedulaFiles.length > 0 && (
          <div className="filesBox">
            <div className="filesHeader">Escaneos</div>
            <ul className="filesList">
              {cedulaFiles.map((f, idx) => (
                <li key={`${f.name}-${idx}`} className="fileRow">
                  <span className="fileName">{f.name}</span>
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

        {/* Lista documentos */}
        {docsFiles.length > 0 && (
          <div className="filesBox">
            <div className="filesHeader">Documentos</div>
            <ul className="filesList">
              {docsFiles.map((f, idx) => (
                <li key={`${f.name}-${idx}`} className="fileRow">
                  <span className="fileName">{f.name}</span>
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

        {/* Comentario */}
        <div className="field">
          <label className="label">Comentario:</label>
          <textarea
            className="textarea"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Ej: El cliente solicita entrega inmediata."
          />
        </div>

        {/* CTA */}
        <button
          className="primaryBtn"
          disabled={!canSubmit || status.state === "loading"}
          onClick={onSubmit}
        >
          {status.state === "loading" ? "Generando..." : "Generar"}
        </button>

        {/* Progreso + Spinner */}
        {status.state === "loading" && (
          <>
            {/* Progreso real del upload (si aplica) */}
            {uploadPct > 0 && uploadPct < 100 && (
              <div className="progressWrap">
                <div className="progressBar">
                  <div
                    className="progressFill"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
                <div className="progressText">{uploadPct}%</div>
              </div>
            )}

            {/* Spinner indeterminado mientras procesa backend */}
            {(uploadPct === 0 || uploadPct >= 100) && (
              <div className="spinnerWrap">
                <div className="spinner" />
                <div className="spinnerText">Procesando…</div>
              </div>
            )}
          </>
        )}

        {/* Status */}
        {status.state !== "idle" && (
          <div className={`status ${status.state}`}>{status.msg}</div>
        )}

        {/* Response */}
        {result && (
          <div className="resultBox">
            <div className="resultTitle">Respuesta</div>
            <pre className="pre">{JSON.stringify(result, null, 2)}</pre>

            {downloadUrl && (
              <a
                className="downloadBtn"
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
              >
                Descargar
              </a>
            )}
          </div>
        )}

        <div className="hint">
          <div>
            <b>Requisito para enviar:</b> al menos 1 documento
          </div>
          <div className="small">
            Endpoint: <code>{API_BASE}/api/notaria-v63-universal</code>
          </div>
          <div className="small">
            template_id fijo: <code>{TEMPLATE_ID}</code>
          </div>
        </div>
      </div>
    </div>
  );
}