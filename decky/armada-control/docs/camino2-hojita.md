# Camino 2 — glyph de perfil de energía INLINE en la barra superior (armada#25)

> Reemplaza el overlay `position:fixed` (Camino 1) que se desalineaba con el reloj/batería.
> El glyph ahora es un HIJO REAL de la fila de la barra, insertado entre la batería y el reloj,
> así que fluye con ellos y no depende de ningún offset en px.
>
> Descubierto EN VIVO por CEF DevTools en el RP6 (2026-09-20). steamui build: **Chrome/126.0.6478.183,
> V8 12.6, React 19** (símbolo de elemento `Symbol(react.transitional.element)`).

## TL;DR del mecanismo
1. Localizar el componente-fila de la barra con `findModuleExport` filtrando por **tres strings estables**
   que su render referencia (no por el nombre minificado del export, que cambia cada build).
2. `afterPatch(memo, "type", …)` envuelve su render; en el árbol devuelto, encontrar el **reloj** por su
   ancla estable y **insertar el glyph justo antes** de su wrapper → queda entre batería y reloj.
3. El glyph (`ProfileGlyphSlot`) es reactivo: sondea el perfil activo (armada#24) → 🌿 eco / ⚡ performance /
   nada en balanced. `currentColor` para heredar el color de los íconos nativos.

## El módulo top-bar (para la sección 07 del manual)
- **Módulo webpack: `62678`, export `hB`** — un `React.memo` (`Symbol(react.memo)`, `compare=null` ⇒
  React lo trata como **SimpleMemoComponent**).
- **Filtro que lo resuelve ÚNICAMENTE** (contra el source de `hB.type`, el render interno del memo):
  ```js
  findModuleExport((e) => {
    const fn = e?.type ?? (typeof e === "function" ? e : null);   // memo → .type
    const s  = Function.prototype.toString.call(fn);
    return s.includes("quickAccessHeader")
        && s.includes("ControllerConfigurator")
        && s.includes("VoiceChat");
  })
  ```
  (`DT` del módulo `70240` — el QuickAccess Menu — también menciona `quickAccessHeader`, pero NO
  `ControllerConfigurator`/`VoiceChat`, y además es una función plana, no un memo → el filtro lo excluye.)
- **Forma del render de `hB`** (parafraseado del build actual):
  ```
  <Cr.Provider value={{region: quickAccessHeader ? 1 : 0}}>
    <Kt>                                   {/* fila; su Focusable = div.…GamepadMode… */}
      {!compact && <Fragment>…búsqueda / wifi / …</Fragment>}
      <tH><Tr/></tH>
      {!controllerCfg && <Fragment>
        <tH><De onClick=Settings("Notifications")/></tH>
        … (rt, tr, zt, RecordingState, Friends) …
        <_  onClick={() => Settings("Power")} />      {/* ← BATERÍA (cluster de energía) */}
        <tH><gr/></tH>                                 {/* ← RELOJ (gr) */}
        {!compact && <tH>{voiceChat}{avatar}</tH>}
      </Fragment>}
    </Kt>
  </Cr.Provider>
  ```
- **Ancla del RELOJ (estable):** el componente del reloj `gr` es el ÚNICO cuyo source contiene **a la vez**
  `"DashboardBar"` y `"vrTooltip"` (`jsx(Ge,{className: L.A(Le().Clock, ti&&Le().DashboardBar), vrTooltip:…})`).
  La batería (`_`) renderiza `Settings("Power")` — no matchea, así que el glyph cae **después** de la
  batería y **antes** del reloj.

## La inserción (`insertBeforeClock`)
DFS sobre el árbol devuelto por `hB.type`. Un elemento "sostiene el reloj" si ÉL es el reloj
(`isClockElement`) o si su hijo único lo es (el reloj viene envuelto: `<tH>{<gr/>}</tH>`). Al encontrar el
sostenedor dentro de un array de children, se hace `splice(i, 0, glyph)` → el glyph queda como hermano
inmediatamente anterior al wrapper del reloj. Si el reloj fuera hijo único (no en array), se reemplaza por
`[glyph, reloj]`.

## Por qué patchear desde el plugin (SharedJSContext) afecta a la barra (render en "Modo Big Picture")
El objeto memo `hB` es **COMPARTIDO** entre contextos CEF: una marca puesta sobre `hB.type` en
SharedJSContext (donde corre Decky) aparece en el fiber vivo del contexto Big Picture. Por eso
`afterPatch(hB, …)` desde el plugin cambia el render de la barra real. (Verificado en vivo, marca cruzada.)

## Gotchas verificados en vivo
- **`afterPatch` de Decky falsea el `.toString()`** de la función parchada para devolver el ORIGINAL
  (`object[property].toString = () => original.toString()`). ⇒ para saber si está parchado NO uses
  `toString()`; usa **`hB.type.__deckyPatch`** (o `.__deckyOrig`).
- **Mount-race (SimpleMemoComponent):** React resuelve y cachea el render interno del memo **al MONTAR**.
  Como Decky parchea `hB.type` DESPUÉS de que la barra ya montó, el glyph aparece en el **siguiente
  re-montaje** de la barra (navegar, abrir el QAM, volver del salvapantallas) — no en un simple re-render.
  Es el comportamiento normal de los parches de top-bar en el ecosistema Decky. En uso normal la barra
  re-monta a los pocos segundos. (Un `forceUpdate` NO basta; sólo un re-mount relee `memo.type`.)
- **NO recargar el contexto Big Picture con `location.reload()`** para forzar re-mount: su URL es un popup
  `about:blank?createflags=…` y recargar lo rompe (cae a `data:text/html` y Steam salta a modo escritorio).
  Recuperación: `systemctl --user restart gamescope-session-plus@steam.service` como `armada`.
- **Deploy live se revierte en el reboot:** `armada-control` está HORNEADO en la imagen del OS; en cada
  boot el plugin en `/home/armada/homebrew/plugins/armada-control` vuelve a la versión de la imagen. El
  `rsync` a homebrew sirve para QA live, pero el fix PERMANENTE exige hornearlo en la imagen (rebuild).

## Verificación en device (2026-09-20)
- El plugin carga, `findModuleExport` resuelve el memo (`target=memo`) y `afterPatch` aplica
  (`hB.type.__deckyPatch === true`), verificado en cold-boot limpio.
- **Placement PROBADO:** con el MISMO `insertBeforeClock`, un marcador de prueba (◆) quedó exactamente
  entre "99%🔋" y "1:09 PM" en la barra real (screenshot). El glyph fluye; al cambiar el ancho del reloj
  (1↔2 dígitos), la batería (ícono de carga) o el %, mantiene su lugar porque es un hermano de flex, no un
  overlay fijo.
- Capturas: `../../../../.claude/worktrees/camino2` (sesión CDP); referencia visual del marcador ◆ entre
  batería y reloj. (Deploy final + QA de Jordi lo hace el orquestador live.)

## Archivos
- `src/lib/topBarProfileIndicator.tsx` — `installTopBarProfileIndicator()` (filtro + afterPatch + walker) y
  `ProfileGlyphSlot` (glyph reactivo, `currentColor`, ~16px, fallback silencioso).
- `src/index.tsx` — llama `installTopBarProfileIndicator()` en `definePlugin`; guarda el disposer para
  `onDismount`. Eliminado el `routerHook.addGlobalComponent` + el componente overlay `TopBarProfileIndicator`.
- Eliminado: `src/components/TopBarProfileIndicator.tsx` (overlay Camino 1).

## Robustez ante updates de Steam
El patrón (patch de la SteamUI) puede romperse en un update MAYOR de Steam — riesgo ACEPTADO del ecosistema
Decky. Si el filtro no matchea (refactor de steamui), `installTopBarProfileIndicator()` loguea UNA vez y
devuelve `null`: el plugin sigue funcionando, sólo sin glyph (degradación segura, nunca una barra rota).
