// UI localization. Strings are written in English at the call site and looked
// up by that English text; a language without an entry for a string shows the
// English text. `{name}` placeholders are filled from `vars`.
// The Spanish catalog (Mexican Spanish) is at the end of this file.

export type Locale = "en" | "es";


// Steam reports its UI language either as a BCP 47 tag ("es-419", "en") or,
// from some APIs, as a Steam language name ("latam", "spanish").
const LANGUAGE_ALIASES: Record<string, Locale> = {
  en: "en",
  english: "en",
  es: "es",
  spanish: "es",
  latam: "es",
};

// The first language the client reports decides: a language we don't ship
// falls back to English rather than to a later, lower-priority source.
export function resolveLocale(candidates: readonly (string | null | undefined)[]): Locale {
  for (const candidate of candidates) {
    const tag = String(candidate ?? "").trim().toLowerCase();
    if (!tag) continue;
    return LANGUAGE_ALIASES[tag.split(/[-_]/)[0]] ?? "en";
  }
  return "en";
}

function detectLocale(): Locale {
  const g = globalThis as any;
  let steam: string | undefined;
  try {
    // Steam's own UI language, as used by its localization of the gamepad UI.
    steam = g.LocalizationManager?.m_rgLocalesToUse?.[0];
  } catch {
    steam = undefined;
  }
  return resolveLocale([steam, g.navigator?.language]);
}

let locale: Locale = detectLocale();

function catalog(): Record<string, string> {
  return locale === "es" ? ES : {};
}

export function currentLocale(): Locale {
  return locale;
}

// For tests.
export function setLocale(next: Locale): void {
  locale = next;
}

// For tests: whether `text` has an entry in the Spanish catalog.
export function hasSpanish(text: string): boolean {
  return Object.prototype.hasOwnProperty.call(ES, text);
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = catalog()[text] ?? text;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  }
  return out;
}

// Labels that come from the system service or config files, translated when
// they are a known string. A trailing detail in parentheses ("Big Cores (3-7)")
// is kept as is.
export function tLabel(label: string): string {
  const match = /^(.*?)(\s+\([^()]*\))$/.exec(label);
  if (match && catalog()[match[1]] !== undefined) return t(match[1]) + match[2];
  return t(label);
}

// Mexican Spanish. Keys are the English strings used at the call sites.
const ES: Record<string, string> = {
  // Shared
  "Loading": "Cargando",
  "Active": "Activo",
  "Cancel": "Cancelar",
  "Close": "Cerrar",
  "Save": "Guardar",
  "Delete": "Eliminar",
  "Default": "Predeterminado",
  "Custom": "Personalizado",
  "Status": "Estado",
  "unknown": "desconocida",
  "unavailable": "no disponible",
  "Something went wrong. Try again.": "Algo salió mal. Inténtalo de nuevo.",
  "Could not load Armada Control": "No se pudo cargar Armada Control",
  "Power profile: {profile}": "Perfil de energía: {profile}",

  // Power tab
  "ACTIVE PROFILE": "PERFIL ACTIVO",
  "Running now": "En uso ahora",
  "Activating...": "Activando...",
  "Make \"{profile}\" active": "Activar \"{profile}\"",
  "You're editing the profile that's active right now -- changes below apply live once saved.":
    "Estás editando el perfil que está activo ahora mismo: los cambios de abajo se aplican en cuanto se guardan.",
  "EDIT POWER PROFILE": "EDITAR PERFIL DE ENERGÍA",
  "PROFILE SETTINGS": "AJUSTES DEL PERFIL",
  "Fan Curve": "Curva del ventilador",
  "CPU Governor": "Gobernador de CPU",
  "CPU Underclock": "Reducción de frecuencia de CPU",
  "CPU Max (%)": "CPU máxima (%)",
  "GPU Min (%)": "GPU mínima (%)",
  "GPU Max (%)": "GPU máxima (%)",
  "Reset to Default": "Restablecer valores predeterminados",
  "None": "Ninguna",
  "Small": "Leve",
  "Medium": "Media",
  "Large": "Alta",
  "Could not switch power profile": "No se pudo cambiar el perfil de energía",

  // Power profiles and fan curves shipped with the system
  "Eco": "Ahorro",
  "Balanced": "Equilibrado",
  "Performance": "Rendimiento",
  "Relaxed": "Tranquila",
  "Moderate": "Moderada",
  "Aggressive": "Agresiva",

  // CPU governors (shown title-cased)
  "Schedutil": "Schedutil",
  "Powersave": "Ahorro de energía",
  "Ondemand": "Bajo demanda",
  "Conservative": "Conservador",

  // Fans tab
  "Armada Fans": "Ventiladores de Armada",
  "Could not load fan curves": "No se pudieron cargar las curvas del ventilador",
  "Could not save fan curves": "No se pudieron guardar las curvas del ventilador",
  "Could not change battery fan floor": "No se pudo cambiar el mínimo del ventilador por batería",
  "BATTERY FAN FLOOR": "MÍNIMO DEL VENTILADOR POR BATERÍA",
  "Floor the fan by battery temperature": "Mínimo del ventilador según la temperatura de la batería",
  "Keeps the fan running (with a boost while charging) even if CPU/GPU are cool, so a hot battery under fast charging still gets airflow. Off restores the stock behaviour.":
    "Mantiene el ventilador encendido (más rápido mientras carga) aunque la CPU y la GPU estén frías, para que una batería caliente por la carga rápida siga recibiendo aire. Apagado, vuelve al comportamiento de fábrica.",
  "SAVE": "GUARDAR",
  "Saving...": "Guardando...",
  "Save Changes": "Guardar cambios",
  "Revert Changes": "Descartar cambios",
  "You have unsaved changes.": "Tienes cambios sin guardar.",

  // Fan curve editor
  "EDIT CURVE": "EDITAR CURVA",
  "Curve": "Curva",
  "No fan curves found": "No se encontraron curvas del ventilador",
  "Used by: {profiles}": "La usan: {profiles}",
  "Not assigned to any profile": "No está asignada a ningún perfil",
  "FAN RESPONSIVENESS": "RESPUESTA DEL VENTILADOR",
  "Ramp Up": "Aceleración",
  "How fast the fan speeds up per ~3-second tick as the target rises.":
    "Qué tan rápido acelera el ventilador en cada ciclo de ~3 segundos cuando sube el objetivo.",
  "Ramp Down": "Desaceleración",
  "How fast the fan slows down per ~3-second tick once the target drops.":
    "Qué tan rápido frena el ventilador en cada ciclo de ~3 segundos cuando baja el objetivo.",
  "Temperature Smoothing (%)": "Suavizado de temperatura (%)",
  "Evens out the temperature reading itself before it reaches the curve, so brief spikes don't yank the target around.":
    "Suaviza la lectura de temperatura antes de aplicar la curva, para que los picos breves no muevan el objetivo de golpe.",
  "Minimum Fan Speed (%)": "Velocidad mínima del ventilador (%)",
  "The lowest speed Armada allows. Fan Stop forces it to 0%.":
    "La velocidad más baja que permite Armada. Con Apagar ventilador queda en 0%.",
  "MANAGE CURVES": "ADMINISTRAR CURVAS",
  "Create Curve": "Crear curva",
  "Curve To Delete": "Curva por eliminar",
  "Tap Again To Confirm Delete": "Toca otra vez para confirmar",
  "Delete Curve": "Eliminar curva",
  "No curves are eligible for deletion -- only a curve with no factory default that isn't assigned to a profile on the Power tab can be removed.":
    "No hay curvas que se puedan eliminar: solo se puede quitar una curva que no sea de fábrica y que no esté asignada a un perfil en la pestaña de energía.",
  "POINTS": "PUNTOS",
  "Drag a point, or press A to steer it with the D-Pad. LB/RB switches points; B exits.":
    "Arrastra un punto, o presiona A para moverlo con la cruceta. LB/RB cambia de punto; B sale.",
  "Drag a point, or press A to steer it with the D-Pad. LB/RB switches points; B exits. Advanced editing uses raw {min}-{max} PWM.":
    "Arrastra un punto, o presiona A para moverlo con la cruceta. LB/RB cambia de punto; B sale. La edición avanzada usa PWM directo de {min} a {max}.",
  "Reset Curve To Factory": "Restablecer curva de fábrica",
  "Nothing here is written to disk until you press Save Changes.":
    "Nada de esto se guarda hasta que presiones Guardar cambios.",
  "Also adjustable via the Minimum Fan Speed slider in Fan Responsiveness.":
    "También se ajusta con el control Velocidad mínima del ventilador en Respuesta del ventilador.",
  "Below the Minimum Fan Speed floor -- tap to lower it to match":
    "Por debajo de la velocidad mínima del ventilador: toca para bajarla y que coincida",
  "Fan Stop": "Apagar ventilador",
  "Fan off below the set temperature.": "El ventilador se apaga por debajo de la temperatura indicada.",
  "Stop Until (°C)": "Apagado hasta (°C)",
  "The 0% minimum applies globally while Fan Stop is enabled.":
    "El mínimo de 0% aplica a todas las curvas mientras Apagar ventilador esté activado.",
  "Fullscreen Editor": "Editor en pantalla completa",
  "Hide Points": "Ocultar puntos",
  "Edit Curve Points": "Editar puntos de la curva",
  "Add Point": "Agregar punto",
  "Temperature (°C)": "Temperatura (°C)",
  "FAN STOPPED": "VENTILADOR APAGADO",
  "Edit Point": "Editar punto",
  "Stop Editing": "Dejar de editar",
  "Curve Name": "Nombre de la curva",
  "Letters, numbers, spaces, hyphens, and underscores are supported.":
    "Se permiten letras, números, espacios, guiones y guiones bajos.",
  "A curve named “{name}” already exists.": "Ya existe una curva llamada “{name}”.",
  "Base Curve": "Curva base",
  "The new curve starts as a copy of the selected base curve. Changes remain unsaved until Save Changes is pressed.":
    "La curva nueva empieza como copia de la curva base elegida. Los cambios no se guardan hasta que presiones Guardar cambios.",

  // RGB tab
  "RGB Lighting": "Iluminación RGB",
  "Enabled": "Activada",
  "Effect": "Efecto",
  "Brightness": "Brillo",
  "Speed": "Velocidad",
  "Color": "Color",
  "Static": "Fijo",
  "Breathing": "Respiración",
  "Color Cycle": "Ciclo de colores",
  "Rainbow": "Arcoíris",
  "CPU Load": "Carga de CPU",
  "Battery": "Batería",
  "Screen Sync": "Sincronizar con la pantalla",
  "Sync w/ screen brightness": "Seguir el brillo de la pantalla",
  "Scales the lighting's brightness to the panel backlight, on top of whatever effect/color is set above. Disables the Brightness slider while on.":
    "Ajusta el brillo de la iluminación al de la pantalla, sobre el efecto y el color elegidos arriba. Mientras está activado, el control de Brillo queda deshabilitado.",
  "Charging Indicator": "Indicador de carga",
  "Show charging status while asleep": "Mostrar la carga mientras está suspendido",
  "While it sleeps and charges, the stick LEDs glow amber (green once full) so you can tell it's charging at a glance.":
    "Mientras está suspendido y cargando, los LED de los sticks se encienden en ámbar (verde al llenarse) para que veas de un vistazo que está cargando.",
  "Could not load RGB lighting": "No se pudo cargar la iluminación RGB",
  "Could not change RGB lighting": "No se pudo cambiar la iluminación RGB",
  "Could not change brightness sync": "No se pudo cambiar la sincronización de brillo",
  "Could not load charging indicator setting": "No se pudo cargar el ajuste del indicador de carga",
  "Could not change charging indicator setting": "No se pudo cambiar el ajuste del indicador de carga",

  // Advanced tab
  "Controller": "Control",
  "Emulation": "Emulación",
  "Launch Calibration": "Abrir calibración",
  "System": "Sistema",
  "Sleep Mode": "Modo de suspensión",
  "Native": "Nativo",
  "Deep": "Profundo",
  "Fake": "Simulado",
  "Enable SSH": "Activar SSH",
  "OS Version": "Versión del sistema",
  "ABL Version": "Versión de ABL",
  "Experimental": "Experimental",
  "Bottom Screen": "Pantalla inferior",
  "Run Plasma Mobile on the second display": "Usar Plasma Mobile en la segunda pantalla",
  "Bottom Screen Brightness": "Brillo de la pantalla inferior",
  "Desktop Mode": "Modo escritorio",
  "USB File Transfer": "Transferencia de archivos por USB",
  "Enabled until shutdown": "Activada hasta apagar",
  "Automatic ABL Updates": "Actualizaciones automáticas de ABL",
  "Updates during shutdown": "Se actualiza al apagar",
  "Could not change bottom screen": "No se pudo cambiar la pantalla inferior",
  "Could not change bottom-screen brightness": "No se pudo cambiar el brillo de la pantalla inferior",
  "Could not change desktop mode": "No se pudo cambiar el modo escritorio",
  "Could not change sleep mode": "No se pudo cambiar el modo de suspensión",

  // Calibration
  "Left Stick": "Stick izquierdo",
  "Right Stick": "Stick derecho",
  "LT": "LT",
  "RT": "RT",
  "Checking controller...": "Revisando el control...",
  "This device can't save calibration, but you can check stick and trigger response here.":
    "Este dispositivo no puede guardar la calibración, pero aquí puedes revisar cómo responden los sticks y los gatillos.",
  "Move both sticks in full circles and fully press both triggers, then Save.":
    "Mueve ambos sticks en círculos completos y presiona a fondo ambos gatillos; luego guarda.",
  "Press Start, then move sticks and triggers through full range.":
    "Presiona Iniciar y luego mueve los sticks y los gatillos en todo su recorrido.",
  "Save Calibration": "Guardar calibración",
  "Start Calibration": "Iniciar calibración",
  "Reset to Defaults": "Restablecer valores predeterminados",
  "Controller calibration isn't available on this device.":
    "La calibración del control no está disponible en este dispositivo.",
  "Couldn't update calibration. Try again.": "No se pudo actualizar la calibración. Inténtalo de nuevo.",

  // Compatibility tab
  "EDIT GAME PROFILE": "EDITAR PERFIL DE JUEGO",
  "Compatibility changes apply on next launch": "Los cambios de compatibilidad se aplican al volver a abrir el juego",
  "Default Proton": "Proton predeterminado",
  "Choose a Proton": "Elige un Proton",
  "{tool} is no longer installed. Choose a new default for your games.":
    "{tool} ya no está instalado. Elige otro predeterminado para tus juegos.",
  "Steam chooses the compatibility tool for each game.": "Steam elige la herramienta de compatibilidad de cada juego.",
  "Apply to New Games": "Aplicar a juegos nuevos",
  "Game Resolution": "Resolución del juego",
  "Compatibility Tool": "Herramienta de compatibilidad",
  "Follow Steam": "Lo que elija Steam",
  "Use Default": "Usar predeterminado",
  "FEX Preset": "Preajuste de FEX",
  "Fast": "Rápido",
  "Compatible": "Compatible",
  "TSO Enabled": "TSO activado",
  "X87 Reduced Precision": "Precisión reducida de X87",
  "Multiblock": "Multibloque",
  "Vector TSO Enabled": "TSO vectorial activado",
  "Memcpy Set TSO Enabled": "TSO en memcpy/memset activado",
  "Half Barrier TSO Enabled": "TSO de media barrera activado",
  "ADVANCED": "AVANZADO",
  "Hide Performance": "Ocultar rendimiento",
  "Host Thunks": "Thunks del host",
  "Hide Host Thunks": "Ocultar thunks del host",
  "Host Vulkan": "Vulkan del host",
  "Host OpenGL": "OpenGL del host",
  "Host ALSA": "ALSA del host",
  "Host DRM": "DRM del host",
  "Host Wayland": "Wayland del host",
  "Environment": "Variables de entorno",
  "Hide Environment": "Ocultar variables de entorno",
  "Default Variables": "Variables predeterminadas",
  "Per-Game Variables": "Variables de este juego",
  "+ Add Variable": "+ Agregar variable",
  "Name": "Nombre",
  "Value": "Valor",
  "Invalid name: must be non-empty, no '='": "Nombre no válido: no puede estar vacío ni llevar '='",
  "Game": "Juego",
  "Gamescope": "Gamescope",
  "CPU Cores": "Núcleos de CPU",
  "All Cores": "Todos los núcleos",
  "Big Cores": "Núcleos grandes",
  "Prime Cores": "Núcleos principales",
  "Little Cores": "Núcleos pequeños",
  "Custom cores (ordered, e.g. 7,3-6)": "Núcleos personalizados (en orden, p. ej. 7,3-6)",
  "Custom cores": "Núcleos personalizados",
  "Wine CPU Topology": "Topología de CPU de Wine",
  "Nice": "Prioridad (nice)",
  "CPU Realtime Scheduling": "Planificación de CPU en tiempo real",
  "Vulkan Realtime Queue": "Cola de Vulkan en tiempo real",
  "CPU Scheduler": "Planificador de CPU",
  "Reset Performance to Default": "Restablecer rendimiento predeterminado",
  "Re-apply to Running Game": "Volver a aplicar al juego abierto",
  "Applying...": "Aplicando...",
  "Applied to running game": "Aplicado al juego abierto",
  "Couldn't apply to the running game.": "No se pudo aplicar al juego abierto.",
  "Restarting Game Mode...": "Reiniciando el modo de juego...",
  "Restart failed: {reason}": "No se pudo reiniciar: {reason}",
  "couldn't restart Game Mode": "no se pudo reiniciar el modo de juego",
  "Invalid entry: {item}": "Valor no válido: {item}",
  "Invalid range: {item}": "Rango no válido: {item}",
  "No such CPU: {cpu}": "No existe la CPU {cpu}",
  "Duplicate CPU: {cpu}": "CPU repetida: {cpu}",
  "Enter cores, e.g. 7,3-6": "Escribe los núcleos, p. ej. 7,3-6",
  "Resolution override is unavailable": "No se puede cambiar la resolución",
  "Failed to set resolution override": "No se pudo cambiar la resolución",
  "Failed to set default resolution": "No se pudo cambiar la resolución predeterminada",
  "Reset Game": "Restablecer juego",
  "Reset All Games": "Restablecer todos los juegos",
  "Resetting...": "Restableciendo...",
  "this game": "este juego",
  "Restores Armada defaults for launch options, resolution, and compatibility across all games.":
    "Restablece los valores de Armada de opciones de lanzamiento, resolución y compatibilidad en todos los juegos.",
  "Restores Armada defaults for {game}. Custom launch options and per-game settings will be removed.":
    "Restablece los valores de Armada para {game}. Se quitarán las opciones de lanzamiento personalizadas y los ajustes de este juego.",
  "Gamescope must restart before this change takes effect. This closes any running game and restarts Steam.":
    "Gamescope debe reiniciarse para aplicar este cambio. Esto cierra el juego abierto y reinicia Steam.",
  "Restart Game Mode": "Reiniciar modo de juego",
  "Later": "Más tarde",

  // Messages from the Armada system service
  "The Armada system service didn't respond (timed out)": "El servicio del sistema de Armada no respondió (tiempo agotado)",
  "Couldn't reach the Armada system service": "No se pudo contactar al servicio del sistema de Armada",
  "The Armada system service returned an unexpected response": "El servicio del sistema de Armada dio una respuesta inesperada",
  "controller calibration is not supported on this device": "este dispositivo no admite calibrar el control",
  "armada-rgb is not installed on this device": "armada-rgb no está instalado en este dispositivo",
  "RGB lighting service isn't responding (timed out)": "El servicio de iluminación RGB no responde (tiempo agotado)",
  "RGB lighting service returned an unexpected response": "El servicio de iluminación RGB dio una respuesta inesperada",
  "RGB lighting is not supported on this device": "Este dispositivo no admite iluminación RGB",
  "armada-power is not installed on this device": "armada-power no está instalado en este dispositivo",
  "could not switch the active power profile": "no se pudo cambiar el perfil de energía activo",
  "armada-power didn't respond (timed out)": "armada-power no respondió (tiempo agotado)",
  "sleep mode is not supported on this device": "este dispositivo no admite ese modo de suspensión",
  "bottom screen is not supported on this device": "este dispositivo no tiene pantalla inferior",
  "bottom-screen brightness is not supported on this device": "este dispositivo no admite el brillo de la pantalla inferior",
  "could not update bottom-screen service": "no se pudo actualizar el servicio de la pantalla inferior",
  "could not update bottom-screen brightness": "no se pudo actualizar el brillo de la pantalla inferior",
  "no running game to re-apply": "no hay un juego abierto al cual volver a aplicar",
};
