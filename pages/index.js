import { useState, useEffect, useCallback } from "react";

const SITUACIONES = {
  1: { label: "Normal", desc: "Al día, sin atrasos relevantes (hasta 31 días)." },
  2: { label: "Seguimiento especial", desc: "Atraso moderado, de 31 a 90 días, en alguna entidad." },
  3: { label: "Con problemas", desc: "Atraso significativo, de 90 a 180 días." },
  4: { label: "Alto riesgo de insolvencia", desc: "Atraso de 180 a 365 días." },
  5: { label: "Irrecuperable", desc: "Atraso mayor a un año." },
  6: { label: "Irrecuperable (disposición técnica)", desc: "Clasificación técnica de irrecuperabilidad." },
};

const TIER_META = {
  normal: { color: "#2E8B67", bg: "#E7F4EC", label: "Al día" },
  baja: { color: "#B8860F", bg: "#FBF1DA", label: "Atención leve" },
  media: { color: "#C4661C", bg: "#FDECDC", label: "Atención media" },
  alta: { color: "#B23A32", bg: "#FBE6E3", label: "Alerta alta" },
  sin_datos: { color: "#7A8790", bg: "#EEF1F2", label: "Sin registros" },
  error: { color: "#7A8790", bg: "#EEF1F2", label: "No se pudo consultar" },
};

function cleanCuit(v) {
  return (v || "").replace(/\D/g, "");
}
function fmtCuit(v) {
  const c = cleanCuit(v);
  if (c.length !== 11) return v;
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}

async function consultarBCRA(cuit) {
  const [deudasRes, chequesRes] = await Promise.allSettled([
    fetch(`/api/deudas/${cuit}`).then((r) => r.json()),
    fetch(`/api/cheques/${cuit}`).then((r) => r.json()),
  ]);

  const deudas = deudasRes.status === "fulfilled" ? deudasRes.value : null;
  const cheques = chequesRes.status === "fulfilled" ? chequesRes.value : null;

  if (!deudas || deudas.error) {
    throw new Error(deudas?.error || "No se pudo consultar la Central de Deudores");
  }

  const periodos = deudas?.results?.periodos || [];
  const ultimoPeriodo = periodos[0] || null;
  const entidades = ultimoPeriodo?.entidades || [];
  const situacionMax = entidades.length
    ? Math.max(...entidades.map((e) => e.situacion || 1))
    : null;
  const denominacion = deudas?.results?.denominacion || null;

  const causales = cheques?.results?.causales || [];
  const chequesDetalle = causales.flatMap((c) =>
    (c.entidades || []).flatMap((e) =>
      (e.detalle || []).map((d) => ({ ...d, causal: c.causal }))
    )
  );
  const chequesSinFondos = chequesDetalle.filter((d) =>
    (d.causal || "").toUpperCase().includes("FONDOS")
  ).length;

  return {
    denominacion,
    situacionMax,
    periodo: ultimoPeriodo?.periodo || null,
    entidadesCount: entidades.length,
    chequesCount: chequesDetalle.length,
    chequesSinFondos,
    checkedAt: new Date().toISOString(),
  };
}

function tierFor(data) {
  if (!data) return "sin_datos";
  if (data.error) return "error";
  if (data.situacionMax == null && data.chequesCount === 0) return "sin_datos";
  if ((data.situacionMax || 0) >= 4 || data.chequesSinFondos >= 2) return "alta";
  if ((data.situacionMax || 0) === 3 || data.chequesSinFondos === 1) return "media";
  if ((data.situacionMax || 0) === 2) return "baja";
  return "normal";
}

function interpretar(data) {
  if (!data) return "Todavía no consultado.";
  if (data.error) return "No se pudo obtener respuesta de la API del BCRA en este momento.";
  const parts = [];
  if (data.situacionMax) {
    const s = SITUACIONES[data.situacionMax];
    parts.push(`${s.label} — ${s.desc}`);
  } else {
    parts.push("Sin financiaciones informadas por entidades al BCRA.");
  }
  if (data.chequesCount > 0) {
    parts.push(
      `${data.chequesCount} cheque(s) rechazado(s) en el registro${
        data.chequesSinFondos ? `, ${data.chequesSinFondos} por falta de fondos` : ""
      }.`
    );
  }
  return parts.join(" ");
}

const STORAGE_KEY = "cartera_sana_clientes";

export default function Home() {
  const [clientes, setClientes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [formErr, setFormErr] = useState("");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [aiLoadingId, setAiLoadingId] = useState(null);
  const [aiText, setAiText] = useState({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setClientes(JSON.parse(raw));
    } catch {
      // sin datos guardados todavía
    } finally {
      setLoaded(true);
    }
  }, []);

  const persist = useCallback((next) => {
    setClientes(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // si falla el guardado, la sesión sigue funcionando en memoria
    }
  }, []);

  async function refrescarCliente(cliente, list) {
    const next = list.map((c) => (c.id === cliente.id ? { ...c, status: "loading" } : c));
    setClientes(next);
    try {
      const data = await consultarBCRA(cliente.cuit);
      const updated = next.map((c) => (c.id === cliente.id ? { ...c, status: "done", data } : c));
      persist(updated);
      return updated;
    } catch {
      const updated = next.map((c) =>
        c.id === cliente.id
          ? { ...c, status: "done", data: { error: true, checkedAt: new Date().toISOString() } }
          : c
      );
      persist(updated);
      return updated;
    }
  }

  async function agregarCliente(e) {
    e.preventDefault();
    const c = cleanCuit(cuit);
    if (!nombre.trim()) { setFormErr("Ingresá un nombre de cliente."); return; }
    if (c.length !== 11) { setFormErr("El CUIT debe tener 11 dígitos."); return; }
    setFormErr("");
    const nuevo = { id: `${Date.now()}`, nombre: nombre.trim(), cuit: c, status: "idle", data: null };
    const next = [...clientes, nuevo];
    persist(next);
    setNombre(""); setCuit("");
    refrescarCliente(nuevo, next);
  }

  function eliminarCliente(id) {
    persist(clientes.filter((c) => c.id !== id));
  }

  async function refrescarTodos() {
    setRefreshingAll(true);
    let list = clientes;
    for (const cliente of clientes) {
      list = await refrescarCliente(cliente, list);
    }
    setRefreshingAll(false);
  }

  async function explicarConIA(cliente) {
    setAiLoadingId(cliente.id);
    try {
      const r = await fetch("/api/explicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: cliente.nombre, cuit: fmtCuit(cliente.cuit), data: cliente.data }),
      });
      const json = await r.json();
      setAiText((prev) => ({
        ...prev,
        [cliente.id]: json.text || json.error || "No se pudo generar la explicación.",
      }));
    } catch {
      setAiText((prev) => ({ ...prev, [cliente.id]: "No se pudo generar la explicación en este momento." }));
    } finally {
      setAiLoadingId(null);
    }
  }

  const alertas = clientes.filter((c) => {
    const t = tierFor(c.data);
    return t === "media" || t === "alta";
  }).length;

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#F3F6F6}
        .app{min-height:100vh;background:#F3F6F6;color:#14232B;font-family:'Sora',system-ui,sans-serif}
        .mono{font-family:'IBM Plex Mono',monospace}
        .hdr{background:#14232B;color:#fff;padding:20px}
        .hdr-in{max-width:840px;margin:0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
        .brand{font-weight:800;font-size:22px;letter-spacing:-.01em}
        .brand small{display:block;font-family:'IBM Plex Mono',monospace;font-weight:400;font-size:11px;
          color:#9FB0AE;letter-spacing:.04em;text-transform:uppercase;margin-top:2px}
        .counter{margin-left:auto;display:flex;align-items:center;gap:8px;background:#1E3138;
          border:1px solid #2C4149;border-radius:999px;padding:7px 14px}
        .counter b{color:#fff;font-size:15px}
        .counter span{font-size:11.5px;color:#9FB0AE}
        .dot-alert{width:8px;height:8px;border-radius:50%;background:#B23A32}
        .wrap{max-width:840px;margin:0 auto;padding:26px 20px 60px}
        .panel{background:#fff;border:1px solid #DCE3E3;border-radius:14px;padding:18px 20px;margin-bottom:20px}
        .panel h2{font-size:14px;font-weight:700;margin-bottom:12px}
        .form-row{display:flex;gap:10px;flex-wrap:wrap}
        .form-row input{flex:1;min-width:160px;border:1px solid #DCE3E3;border-radius:9px;padding:10px 12px;
          font-family:inherit;font-size:14px;background:#F3F6F6}
        .form-row input:focus{outline:2px solid #14232B;outline-offset:1px}
        .btn{border:none;border-radius:9px;font-family:inherit;font-weight:600;font-size:13.5px;
          padding:10px 16px;cursor:pointer;background:#14232B;color:#fff}
        .btn:hover{background:#1E3138}
        .btn:disabled{opacity:.45;cursor:default}
        .btn.ghost{background:transparent;color:#14232B;border:1px solid #DCE3E3}
        .btn.ghost:hover{border-color:#14232B}
        .err{color:#B23A32;font-size:12.5px;margin-top:6px}
        .toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
        .toolbar h2{font-size:14px;font-weight:700}
        .empty{color:#4A5A62;font-size:13.5px;padding:20px 4px;text-align:center}
        .card{background:#fff;border:1px solid #DCE3E3;border-radius:14px;padding:16px 18px;
          margin-bottom:12px;display:flex;gap:14px;align-items:flex-start}
        .bar{width:6px;align-self:stretch;border-radius:4px;flex-shrink:0}
        .card-body{flex:1;min-width:0}
        .card-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
        .c-name{font-weight:700;font-size:15px}
        .c-cuit{font-size:12px;color:#4A5A62}
        .badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
        .interp{font-size:13.5px;color:#4A5A62;margin-top:6px;line-height:1.5}
        .meta{font-size:11px;color:#8A9598;margin-top:8px;display:flex;gap:14px;flex-wrap:wrap}
        .row-actions{display:flex;gap:8px;margin-top:10px}
        .mini{font-size:12px;padding:6px 11px;border-radius:7px}
        .ai-box{margin-top:10px;padding:10px 12px;background:#F3F6F6;border-radius:9px;
          border-left:3px solid #14232B;font-size:13px;line-height:1.5}
        .spin{display:inline-block;width:12px;height:12px;border:2px solid #cfd6d6;
          border-top-color:#14232B;border-radius:50%;animation:sp .7s linear infinite}
        @keyframes sp{to{transform:rotate(360deg)}}
        .foot{max-width:840px;margin:0 auto;padding:0 20px 30px;font-family:'IBM Plex Mono',monospace;
          font-size:10.5px;color:#7A8790;line-height:1.6}
      `}</style>

      <header className="hdr">
        <div className="hdr-in">
          <div className="brand">Cartera Sana<small>Monitor de riesgo crediticio · Fuente: BCRA</small></div>
          <div className="counter">
            <span className="dot-alert" style={{ opacity: alertas ? 1 : 0.25 }} />
            <b>{alertas}</b>
            <span>alerta{alertas === 1 ? "" : "s"} activa{alertas === 1 ? "" : "s"}</span>
          </div>
        </div>
      </header>

      <div className="wrap">
        <div className="panel">
          <h2>Agregar cliente a la cartera</h2>
          <form className="form-row" onSubmit={agregarCliente}>
            <input placeholder="Nombre o razón social" value={nombre}
              onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del cliente" />
            <input placeholder="CUIT (11 dígitos)" value={cuit}
              onChange={(e) => setCuit(e.target.value)} aria-label="CUIT" inputMode="numeric" />
            <button className="btn" type="submit">Agregar y consultar</button>
          </form>
          {formErr && <div className="err">{formErr}</div>}
        </div>

        <div className="toolbar">
          <h2>Cartera ({clientes.length})</h2>
          {clientes.length > 0 && (
            <button className="btn ghost mini" onClick={refrescarTodos} disabled={refreshingAll}>
              {refreshingAll ? "Actualizando…" : "Actualizar todos"}
            </button>
          )}
        </div>

        {!loaded && <div className="empty">Cargando cartera…</div>}
        {loaded && clientes.length === 0 && (
          <div className="empty">
            Todavía no cargaste clientes. Sumá el primero arriba — se consulta
            automáticamente contra la Central de Deudores del BCRA.
          </div>
        )}

        {clientes.map((c) => {
          const tier = c.status === "loading" ? null : tierFor(c.data);
          const meta = tier ? TIER_META[tier] : null;
          return (
            <div className="card" key={c.id}>
              <div className="bar" style={{ background: meta ? meta.color : "#DCE3E3" }} />
              <div className="card-body">
                <div className="card-top">
                  <div>
                    <div className="c-name">{c.nombre}</div>
                    <div className="c-cuit mono">{fmtCuit(c.cuit)}</div>
                  </div>
                  {c.status === "loading" ? (
                    <span className="badge" style={{ background: "#EEF1F2", color: "#7A8790" }}>
                      <span className="spin" /> consultando
                    </span>
                  ) : (
                    <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  )}
                </div>

                {c.status !== "loading" && <div className="interp">{interpretar(c.data)}</div>}

                {c.data?.denominacion && (
                  <div className="meta">
                    <span>Registrado como: {c.data.denominacion}</span>
                    {c.data.periodo && <span>Período: {c.data.periodo}</span>}
                  </div>
                )}
                {c.data?.checkedAt && (
                  <div className="meta">
                    <span>Última consulta: {new Date(c.data.checkedAt).toLocaleString("es-AR")}</span>
                  </div>
                )}

                {aiText[c.id] && <div className="ai-box">{aiText[c.id]}</div>}

                <div className="row-actions">
                  <button className="btn ghost mini" onClick={() => refrescarCliente(c, clientes)}
                    disabled={c.status === "loading"}>Actualizar</button>
                  {c.status === "done" && !c.data?.error && (
                    <button className="btn ghost mini" onClick={() => explicarConIA(c)}
                      disabled={aiLoadingId === c.id}>
                      {aiLoadingId === c.id ? "Redactando…" : "Explicar con IA"}
                    </button>
                  )}
                  <button className="btn ghost mini" onClick={() => eliminarCliente(c.id)}>Quitar</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="foot">
        Datos obtenidos en vivo de la API pública de la Central de Deudores del BCRA
        (api.bcra.gob.ar), consultada desde el servidor de esta app. Es información
        pública oficial, no un scoring propio ni un informe crediticio privado. No
        implica conformidad del BCRA con este uso. Esta herramienta no decide si
        otorgar o cortar crédito — brinda información para que la decisión comercial
        la tome la PyME.
      </div>
    </div>
  );
}
