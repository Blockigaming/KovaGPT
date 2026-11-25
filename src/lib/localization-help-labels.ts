import type { SupportedLocale } from "@/lib/locales";

/** Help center questions, answers and page text, keyed by the English text. Loaded on demand. */
export const HELP_LABELS: Partial<Record<SupportedLocale, Record<string, string>>> = {
  es: {
    "Why is Thinking blue?": "¿Por qué Pensando está en azul?",
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      "El cerebro y la etiqueta Pensando se ponen azules cuando el razonamiento profundo está activado. Vuelve a pulsar el botón para volver al modo predeterminado. Free tiene un simple interruptor; Plus y Pro tienen niveles de modelo adicionales.",
    "How do I resize or color the sidebar?":
      "¿Cómo cambio el tamaño o el color de la barra lateral?",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "En el ordenador, arrastra el borde derecho de la barra lateral. También puedes enfocarlo y pulsar Izquierda o Derecha; Inicio y Fin usan el ancho mínimo y máximo. Abre Más → Personalizar barra lateral para elegir elementos, color, posición de la búsqueda y chats recientes. Se guarda para esta cuenta en este navegador.",
    "How do I copy or remove a chat link?": "¿Cómo copio o quito el enlace de un chat?",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "Elige Compartir en un chat guardado para copiar su enlace público. Cualquiera con el enlace puede leer esa captura durante 30 días; no incluye archivos ni mensajes futuros. Revoca enlaces en Configuración → Controles de datos. El aviso de éxito solo aparece cuando el portapapeles acepta el enlace.",
    "The clipboard won't copy a share link.": "El portapapeles no copia el enlace.",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "Si falla el portapapeles, el enlace aparece en un cuadro de diálogo. Selecciónalo para copiarlo a mano o pulsa Copiar enlace para reintentar.",
    "Which image shapes and custom sizes can I use?":
      "¿Qué formatos y tamaños de imagen puedo usar?",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "Elige Cuadrado 1:1, Horizontal 3:2, Vertical 2:3, Panorámico 16:9, Historia 9:16 o Personalizado con un modelo compatible. Los lados personalizados deben ser múltiplos de 16, de hasta 3840 píxeles, con 655.360–8.294.400 píxeles en total y una proporción de 1:3 a 3:1. Las imágenes grandes pueden tardar más.",
    "How do I create an image in a normal chat?": "¿Cómo creo una imagen en un chat normal?",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "Abre el menú + y elige Crear imagen, describe lo que quieres y envía el mensaje. Necesitas iniciar sesión y tener cupo de imágenes. El resultado se queda en esa conversación y puedes guardarlo en la biblioteca.",
    "Why doesn't the activity panel show Cloud browser?":
      "¿Por qué el panel de actividad no muestra el navegador en la nube?",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "El panel muestra las fuentes y resultados registrados de esta conversación. La vista previa y el número de pestañas aparecen cuando una integración de navegador aporta datos reales de una sesión activa. Una búsqueda web por sí sola no significa que haya un navegador en la nube activo.",
    "How much usage does each plan include?": "¿Cuánto uso incluye cada plan?",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "Free tiene un uso muy limitado. Plus cuesta 16 $ al mes y ofrece más uso dinámico de chat. Pro cuesta 80 $ al mes y ofrece el mayor cupo. El uso varía según el modelo y la tarea, y hay límites en todos los modelos.",
    "Scheduled tasks says access could not be verified.":
      "Tareas programadas dice que no se pudo verificar el acceso.",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "Recarga una vez y confirma que la misma cuenta verificada tiene la sesión iniciada. Si continúa, Soporte debe revisar el esquema de tareas y las funciones de acceso. Recargar no repara una migración de base de datos que falte. No elimines tareas como solución.",
    "My task is saved but background execution isn't ready.":
      "Mi tarea está guardada, pero la ejecución en segundo plano no está lista.",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "Revisa el estado y la zona horaria de la tarea. La ejecución programada requiere un proveedor configurado, una política aprobada y un programador en buen estado. Si la página indica un problema del servicio, conserva la tarea y contacta con Soporte; ejecutarla varias veces puede duplicar trabajo.",
    "What is KovaGPT?": "¿Qué es KovaGPT?",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "KovaGPT es un espacio de trabajo con IA para conversaciones, búsqueda web, archivos compatibles, imágenes, proyectos y apps conectadas. La disponibilidad depende de tu plan y de los proveedores configurados.",
    "What should I try first?": "¿Qué debería probar primero?",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "Inicia un chat y haz una pregunta concreta o describe el resultado que buscas. Para trabajos continuos, elige Proyectos en la barra lateral y mantén juntos chats, instrucciones y archivos.",
    "How do I start a new chat?": "¿Cómo inicio un chat nuevo?",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "Selecciona Nuevo chat en la barra lateral. Elige un modo o herramienta, escribe tu mensaje y envíalo.",
    "Where are my previous chats?": "¿Dónde están mis chats anteriores?",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "Los chats normales con sesión iniciada se sincronizan con tu cuenta cuando la sincronización está disponible. Los cambios sin conexión se quedan en este dispositivo hasta confirmarse; el chat temporal no se guarda en el historial.",
    "Can I use KovaGPT without an account?": "¿Puedo usar KovaGPT sin una cuenta?",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "Necesitas una cuenta verificada para chatear, crear o editar imágenes, gestionar la biblioteca y usar las herramientas. Elige Iniciar sesión o Crear una cuenta. La ayuda, los precios, la información legal y los enlaces compartidos de solo lectura son públicos.",
    "Does KovaGPT work on mobile?": "¿KovaGPT funciona en el móvil?",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "Sí. KovaGPT se adapta a cualquier pantalla y puede instalarse como app web si el navegador lo permite.",
    "Which browsers are supported?": "¿Qué navegadores son compatibles?",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "Usa una versión actual de un navegador moderno. Si falta una función como llaves de acceso, instalación o notificaciones, actualiza el navegador o prueba otro.",
    "How do I create an account?": "¿Cómo creo una cuenta?",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "Elige Iniciar sesión y continúa con un proveedor disponible o con tu correo. La pantalla muestra solo los métodos habilitados.",
    "How do I change my display name or profile image?":
      "¿Cómo cambio mi nombre visible o foto de perfil?",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "Abre tu menú de perfil → Configuración → Cuenta y actualiza los campos disponibles. Los datos gestionados por un proveedor pueden cambiarse allí.",
    "How do I change my password?": "¿Cómo cambio mi contraseña?",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "Elige ¿Olvidaste tu contraseña? en la pantalla de acceso con correo. Las cuentas creadas con Google u otro proveedor gestionan la contraseña allí.",
    "How does Google sign-in work?": "¿Cómo funciona el acceso con Google?",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "Elige Continuar con Google y aprueba la solicitud. KovaGPT no recibe tu contraseña de Google.",
    "Why did Google sign-in fail?": "¿Por qué falló el acceso con Google?",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "Reintenta, recarga la página, permite la ventana de acceso y comprueba que las cookies no estén bloqueadas. Luego prueba otro navegador y contacta con soporte si continúa.",
    "I cannot sign in. What should I try?": "No puedo iniciar sesión. ¿Qué hago?",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "Reintenta una vez, recarga, revisa tu conexión y pide un nuevo correo de acceso o de restablecimiento. Revisa los bloqueadores de privacidad y prueba otro navegador o dispositivo antes de contactar con soporte.",
    "Why did my sign-in email not arrive?": "¿Por qué no llegó mi correo de acceso?",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "Revisa spam y promociones, confirma la dirección y pide un correo nuevo. Usa solo el enlace más reciente: los antiguos o caducados pueden no funcionar.",
    "Does KovaGPT support passkeys?": "¿KovaGPT admite llaves de acceso?",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "El acceso con llave está disponible si está habilitado y tu navegador y dispositivo lo admiten. Gestiona tus llaves en Configuración.",
    "How do I send a message?": "¿Cómo envío un mensaje?",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "Escribe en el cuadro de mensaje y pulsa Enviar o usa el atajo de teclado. Adjunta contexto antes de enviar si lo necesitas.",
    "How do I stop a response?": "¿Cómo detengo una respuesta?",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "Usa el botón de detener que sustituye a Enviar mientras se genera la respuesta. Se conserva lo ya recibido.",
    "Can I regenerate an answer?": "¿Puedo regenerar una respuesta?",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "Usa la acción de reintentar en una respuesta completada o fallida cuando aparezca. El nuevo resultado puede variar, así que verifica lo importante.",
    "Can I edit a previous message?": "¿Puedo editar un mensaje anterior?",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "Usa la acción de editar cuando aparezca en tu mensaje. Editar crea un camino nuevo desde ese punto, así que el contexto posterior puede cambiar.",
    "How do I copy an answer?": "¿Cómo copio una respuesta?",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "Usa la acción de copiar de la respuesta. Para elementos generados, usa el editor o las opciones de exportación.",
    "How do I rename or delete a conversation?":
      "¿Cómo cambio el nombre o elimino una conversación?",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "Abre el menú de la conversación en el historial y elige Cambiar nombre o Eliminar. Confirma con cuidado: puede no ser recuperable.",
    "Why can KovaGPT make mistakes?": "¿Por qué KovaGPT puede equivocarse?",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "Las respuestas de IA pueden ser incompletas o incorrectas. Verifica afirmaciones, cálculos y fuentes importantes, sobre todo en decisiones médicas, legales, financieras o de seguridad.",
    "Does a new chat remember an earlier chat?": "¿Un chat nuevo recuerda uno anterior?",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "Solo la memoria adaptativa puede llevar contexto entre chats normales, y está disponible para usuarios Plus y Pro con sesión iniciada si está activada. Si no, cada chat empieza con su propio contexto.",
    "Why did a long conversation lose context?":
      "¿Por qué una conversación larga perdió el contexto?",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "Las conversaciones muy largas pueden superar el contexto del modelo. Repite los detalles importantes, adjunta una fuente breve o empieza un chat nuevo con un resumen.",
    "What is Lite mode?": "¿Qué es el modo Lite?",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      "El modo predeterminado es el más rápido. En Free, el botón Pensando con forma de cerebro activa el razonamiento profundo o vuelve al predeterminado. Plus añade Medio y Alto; Pro añade Extra alto, Máx. y Ultra. Se necesita una cuenta.",
    "What is Medium mode?": "¿Qué es el modo Medio?",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "Medio da al mismo modelo más tiempo de trabajo que Lite. Disponible en Plus y Pro.",
    "What is Thinking mode?": "¿Qué es el modo Pensando?",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "Pensando es el nombre en Plus del modo de mayor esfuerzo. Usa el mismo modelo con más tiempo que Medio.",
    "What is High mode?": "¿Qué es el modo Alto?",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "Alto es el nombre en Pro de ese modo de mayor esfuerzo. Disponible en Pro.",
    "What is Extra High mode?": "¿Qué es el modo Extra alto?",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "Extra alto da al mismo modelo más tiempo acotado para analizar, comprobar y revisar. Disponible en Pro.",
    "What is Max mode?": "¿Qué es el modo Máx.?",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "Máx. usa un presupuesto de trabajo mayor con el mismo modelo para tareas difíciles. Disponible en Pro.",
    "What is Ultra mode?": "¿Qué es el modo Ultra?",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "Ultra es el nivel más profundo de Pro y puede coordinar subagentes acotados sobre el mismo modelo.",
    "Which modes are on each plan?": "¿Qué modos incluye cada plan?",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "Free incluye Lite y Medio. Plus incluye Lite, Medio, Alto, Extra alto y Máx. Pro incluye Lite, Medio, Alto, Extra alto, Máx. y Ultra. Las generaciones anteriores de Kova siguen disponibles para trabajos antiguos.",
    "Why do I not see every mode?": "¿Por qué no veo todos los modos?",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "Los modos dependen de tu plan y de la disponibilidad del servicio. Recarga tras cambiar de plan; si Facturación muestra el nuevo plan pero falta el modo, cierra e inicia sesión y luego contacta con soporte.",
    "Do more capable modes take longer?": "¿Los modos más potentes tardan más?",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "Pueden. Los modos de mayor esfuerzo pueden tardar más que Lite o Medio, sobre todo en tareas complejas.",
    "What does Search do?": "¿Qué hace Buscar?",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "Buscar obtiene fuentes web actuales cuando los proveedores están disponibles. Abre los enlaces citados y verifica que respaldan la respuesta.",
    "When should I use Search?": "¿Cuándo debo usar Buscar?",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "Úsalo para noticias, datos recientes de productos, información pública en vivo o cuando quieras fuentes web. No suele hacer falta para reescribir o para preguntas sobre texto que tú aportas.",
    "Does Search browse the live web?": "¿Buscar navega por la web en vivo?",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "Buscar puede obtener fuentes actuales cuando sus proveedores están disponibles. Las páginas enlazadas son la fuente de verdad.",
    "Can KovaGPT cite sources?": "¿KovaGPT puede citar fuentes?",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "Buscar puede devolver fuentes enlazadas. Abre cada cita y confirma que respalda la afirmación.",
    "Why might two searches differ?": "¿Por qué pueden diferir dos búsquedas?",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "Las páginas y los rankings cambian, y otras palabras pueden traer otras pruebas. Compara las citas en lugar de fiarte solo del resumen.",
    "Why is Search unavailable?": "¿Por qué Buscar no está disponible?",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "Buscar depende de los proveedores y de tu cupo. Recarga, confirma que la herramienta está seleccionada e inténtalo de nuevo; si sigue sin funcionar, contacta con soporte.",
    "What files can I upload to chat?": "¿Qué archivos puedo subir al chat?",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "El chat acepta texto, código, CSV, JSON e imágenes, y extrae el texto legible de PDF, DOCX, XLSX y PPTX compatibles. El conocimiento del proyecto indexa archivos de texto compatibles. La extracción se limita a 10 MB y puede omitir formato, contenido escaneado o páginas ilegibles. La vista previa del PDF original en la biblioteca es distinta del texto extraído; los originales de Office se pueden descargar pero no se muestran.",
    "How do I upload a file?": "¿Cómo subo un archivo?",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "Usa el botón de adjuntar del cuadro de mensaje y elige un archivo compatible. Espera a que termine de prepararse antes de enviar.",
    "Why did my upload fail?": "¿Por qué falló la subida?",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "Reintenta, confirma que el tipo y tamaño son compatibles y revisa tu conexión y cupo. Recarga y prueba un archivo cada vez; si sigue fallando, contacta con soporte indicando el tipo de archivo y el error.",
    "Can KovaGPT analyze spreadsheets?": "¿KovaGPT puede analizar hojas de cálculo?",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "KovaGPT puede razonar sobre texto, CSV, JSON e imágenes y mostrar tablas o gráficos. No ofrece un entorno general para ejecutar hojas de cálculo ni código subido.",
    "Can KovaGPT understand uploaded images?": "¿KovaGPT entiende las imágenes que subo?",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "El chat acepta imágenes compatibles y razona sobre su contenido visible. Puede pasar por alto texto pequeño o detalles ambiguos; compáralo con el original.",
    "Are file limits different by plan?": "¿Los límites de archivos cambian según el plan?",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "Sí. Los cupos de subida y almacenamiento aumentan según el plan. Consulta Precios y el uso que muestra el producto.",
    "Can I remove a file before sending?": "¿Puedo quitar un archivo antes de enviar?",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "Sí. Usa el botón de quitar en la vista previa del adjunto antes de enviar.",
    "How do I generate an image?": "¿Cómo genero una imagen?",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "Abre Imágenes, describe el tema, la composición y el estilo, elige los ajustes y genera. Necesitas iniciar sesión y tener cupo de imágenes.",
    "How should I describe the image I want?": "¿Cómo describo la imagen que quiero?",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "Indica el tema, el entorno, la composición, la luz, la técnica y lo que no quieres. Las indicaciones claras funcionan mejor que muchos adjetivos vagos.",
    "Can I edit an existing image?": "¿Puedo editar una imagen existente?",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "Edita una imagen de la biblioteca con un modelo compatible. Una máscara PNG transparente opcional puede guiar el cambio. Se aplica el cupo de imágenes.",
    "Why was an image request rejected?": "¿Por qué se rechazó mi solicitud de imagen?",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "Puede rechazarse por normas de seguridad, ajustes no válidos, una imagen de origen no compatible o disponibilidad del proveedor. Reformula sin contenido prohibido y usa ajustes compatibles.",
    "Why is image generation slow?": "¿Por qué tarda la generación de imágenes?",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "El tiempo varía según la carga del proveedor y los ajustes. Mantén la página abierta, reintenta solo tras un error y evita solicitudes duplicadas.",
    "Are image limits plan dependent?": "¿Los límites de imágenes dependen del plan?",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "Sí. Cada plan tiene un cupo diario de imágenes, mayor en los planes de pago.",
    "What is Canvas?": "¿Qué es Canvas?",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "Los textos, códigos y sitios generados pueden abrirse en un editor con exportación y versiones de la sesión. Las versiones no se conservan al cerrar el editor.",
    "What are Projects?": "¿Qué son los Proyectos?",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "Los proyectos organizan chats, archivos, imágenes, notas, tareas, memoria del proyecto e instrucciones.",
    "How do I create a project?": "¿Cómo creo un proyecto?",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "Selecciona Proyectos en la barra lateral, elige Nuevo proyecto, completa los datos y créalo.",
    "How do I rename a project?": "¿Cómo cambio el nombre de un proyecto?",
    "Open the project and use its settings or project menu to update the name.":
      "Abre el proyecto y usa su configuración o menú para cambiar el nombre.",
    "How do I delete a project?": "¿Cómo elimino un proyecto?",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "Abre la configuración del proyecto, elige Eliminar proyecto y confirma. También se eliminan sus registros y archivos, así que revisa la confirmación.",
    "How do I add chats to a project?": "¿Cómo añado chats a un proyecto?",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "Inicia un chat desde dentro del proyecto. Si aparece la opción de mover, también puedes asignar un chat existente.",
    "Can I upload files to a project?": "¿Puedo subir archivos a un proyecto?",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "Sí. El conocimiento del proyecto acepta archivos compatibles, según tu cupo de subida y almacenamiento.",
    "Does project context carry across chats?":
      "¿El contexto del proyecto se comparte entre chats?",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "Las instrucciones, el conocimiento, las notas y la memoria del proyecto pueden dar contexto a sus chats. Deja explícitas las instrucciones clave y verifica los resultados importantes.",
    "Can I share a project?": "¿Puedo compartir un proyecto?",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "Los propietarios pueden abrir Miembros e invitar a colaboradores. Requiere que el servicio de colaboración esté disponible.",
    "How do project invitations work?": "¿Cómo funcionan las invitaciones?",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "El propietario envía una invitación a un correo. La persona inicia sesión con esa identidad y acepta antes de acceder.",
    "Can someone without an account accept a project invitation?":
      "¿Alguien sin cuenta puede aceptar una invitación?",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "Necesita una cuenta de KovaGPT asociada a esa identidad para participar.",
    "What happens when a collaborator is removed?": "¿Qué pasa si se quita a un colaborador?",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "Pierde el acceso al proyecto. Lo que haya copiado o exportado antes no se recupera.",
    "Can I leave a shared project?": "¿Puedo salir de un proyecto compartido?",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "Pide al propietario que te quite como miembro. El propietario conserva el proyecto.",
    "Who owns a shared project?": "¿Quién es el dueño de un proyecto compartido?",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "La cuenta que lo creó sigue siendo la propietaria salvo que se confirme un cambio.",
    "What is Library?": "¿Qué es la Biblioteca?",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "La biblioteca contiene lo que guardas o subes; no es una copia automática de cada conversación.",
    "How do I save something to Library?": "¿Cómo guardo algo en la biblioteca?",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "Usa Guardar en la biblioteca en una respuesta, imagen o archivo. Solo aparece lo que guardas o subes.",
    "Can I reopen or remove a Library item?": "¿Puedo volver a abrir o quitar un elemento?",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "Abre la biblioteca, selecciona el elemento para abrirlo o usa eliminar para quitarlo. Confirma con cuidado.",
    "Can I organize Library items?": "¿Puedo organizar la biblioteca?",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "Sí. Hay carpetas y opciones para mover varios elementos a la vez.",
    "How do I share a chat?": "¿Cómo comparto un chat?",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "Usa Compartir en la conversación. Revisa la vista previa y el acceso antes de crear o enviar el enlace.",
    "Does a shared chat update automatically?": "¿Un chat compartido se actualiza solo?",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "La vista previa indica lo que verán los destinatarios. Revísala de nuevo si cambias la conversación original.",
    "Which apps can I connect?": "¿Qué apps puedo conectar?",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "La página de apps incluye Google, Gmail, Google Drive, Google Calendar y GitHub. Cada conexión depende de las credenciales, los permisos concedidos y la disponibilidad del servicio.",
    "How do I connect an app?": "¿Cómo conecto una app?",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "Abre Apps en la barra lateral, elige un proveedor y revisa la pantalla de consentimiento. Aprueba solo los permisos que entiendas.",
    "How do I disconnect or reconnect an app?": "¿Cómo desconecto o vuelvo a conectar una app?",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "Abre Apps, elige el servicio y pulsa Desconectar. Para reconectar, inicia de nuevo la conexión y aprueba los permisos.",
    "Why does an integration ask for permission?": "¿Por qué una integración pide permisos?",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "La pantalla del proveedor muestra los permisos necesarios. KovaGPT solo puede usar el acceso concedido.",
    "What happens when I revoke access?": "¿Qué pasa si revoco el acceso?",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "Las nuevas acciones dejan de funcionar. Los datos ya traídos a un chat o proyecto no se borran solos; elimínalos aparte si hace falta.",
    "Why did a connected app stop working?": "¿Por qué dejó de funcionar una app conectada?",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "Reintenta, revisa el estado y los permisos en Apps y, si procede, desconecta y vuelve a conectar. Las caídas del proveedor o la configuración también pueden afectar.",
    "How does Gmail integration work?": "¿Cómo funciona la integración con Gmail?",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "Conecta Gmail desde Apps. Las acciones de lectura o escritura dependen de los permisos, las credenciales y la disponibilidad.",
    "Can KovaGPT search my email or read attachments?":
      "¿KovaGPT puede buscar en mi correo o leer adjuntos?",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "Solo puede hacer las acciones de Gmail que permitan la conexión y los permisos. Revisa la acción y la fuente antes de fiarte.",
    "Can KovaGPT draft or send email?": "¿KovaGPT puede redactar o enviar correos?",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "Las acciones de escritura en Gmail requieren tu confirmación explícita. KovaGPT nunca envía correos sin avisar.",
    "Can KovaGPT check or change my calendar?": "¿KovaGPT puede consultar o cambiar mi calendario?",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "Google Calendar puede leer o escribir solo con los permisos concedidos. Crear o cambiar eventos requiere confirmación.",
    "Can KovaGPT search Google Drive?": "¿KovaGPT puede buscar en Google Drive?",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "Google Drive se conecta desde Apps. Buscar y leer dependen de los permisos, los tipos de archivo y la disponibilidad.",
    "Can KovaGPT modify Drive files?": "¿KovaGPT puede modificar archivos de Drive?",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "No des por hecho que pueda editar Drive en general. Solo se ejecutan acciones mostradas para confirmar y permitidas por la conexión.",
    "How does GitHub integration work?": "¿Cómo funciona la integración con GitHub?",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "Conecta GitHub desde Apps y revisa sus permisos. Las acciones dependen del acceso concedido y de lo que admita la integración.",
    "What is Local places?": "¿Qué es Lugares locales?",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "Lugares locales es la experiencia de Mapas prevista en KovaGPT. No estará disponible hasta aprobar proveedor, aspectos legales, privacidad, capacidad y costes.",
    "Can it search real places?": "¿Puede buscar lugares reales?",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "No en la versión actual. Si se aprueba Mapas, podrá buscar en un proveedor externo revisado; verifica siempre los datos antes de ir porque pueden cambiar.",
    "Can it provide directions?": "¿Puede dar indicaciones?",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "KovaGPT puede abrir un mapa externo para las indicaciones. No ofrece navegación paso a paso propia.",
    "Does KovaGPT use my device location?": "¿KovaGPT usa la ubicación de mi dispositivo?",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "No mientras Mapas no esté disponible. Si se aprueba, KovaGPT solo pedirá tus coordenadas cuando elijas el control de ubicación e indicará qué proveedores las reciben. Mapas no guarda coordenadas en Configuración.",
    "Why is Local places unavailable?": "¿Por qué Lugares locales no está disponible?",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "Mapas está desactivado a propósito mientras se aprueban proveedor, licencias, atribución, privacidad, capacidad y costes. En este estado no pide tu ubicación ni contacta con proveedores de mapas.",
    "Where are Settings?": "¿Dónde está la configuración?",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "Abre tu menú de perfil y elige Configuración. Incluye cuenta, personalización, memoria, apps, suscripción, privacidad y apariencia, según corresponda.",
    "How do I change appearance?": "¿Cómo cambio la apariencia?",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "Abre tu menú de perfil → Configuración → Apariencia y elige un tema.",
    "Can I change how KovaGPT responds?": "¿Puedo cambiar cómo responde KovaGPT?",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "Usa la personalización e instrucciones explícitas en el chat o en un proyecto. KovaGPT aplica esas preferencias a las respuestas futuras.",
    "What is Adaptive Memory?": "¿Qué es la memoria adaptativa?",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "La memoria está disponible en Free, con más capacidad en Plus y Pro. Las actualizaciones desde conversaciones son opcionales y las notas se pueden editar o borrar. Los chats temporales nunca la usan.",
    "How do I turn Memory off or delete it?": "¿Cómo desactivo o borro la memoria?",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "Abre Configuración → Memoria. Desactívala para bloquear su uso y nuevas escrituras, o elige Eliminar memoria guardada para borrarla.",
    "Is Memory the same as chat history?": "¿La memoria es lo mismo que el historial?",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "No. El historial guarda conversaciones; la memoria adaptativa guarda contexto seleccionado entre chats. Desactivar o borrar la memoria no borra el historial ni los borradores.",
    "Does Temporary Chat use Memory?": "¿El chat temporal usa la memoria?",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "No. El chat temporal no usa ni actualiza la memoria y no aparece en el historial.",
    "How do notifications work?": "¿Cómo funcionan las notificaciones?",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "Abre Notificaciones para ver los avisos. Las notificaciones push requieren un navegador compatible, permiso y configuración.",
    "What plans does KovaGPT offer?": "¿Qué planes ofrece KovaGPT?",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "KovaGPT ofrece Free, Plus y Pro. Las necesidades de empresa se tratan aparte; el alcance y las condiciones se confirman antes de la compra.",
    "How much do Plus and Pro cost?": "¿Cuánto cuestan Plus y Pro?",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "Los precios mensuales son 16 USD para Plus y 80 USD para Pro, sin impuestos. Confirma el importe final en Stripe antes de pagar.",
    "How does the first-month discount work?": "¿Cómo funciona el descuento del primer mes?",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "Las cuentas elegibles tienen un 50 % de descuento en el primer mes de Plus o Pro mensual, una vez por cuenta. Después se aplica el precio normal. Las suscripciones nuevas no tienen prueba gratuita; las pruebas existentes mantienen sus condiciones. Stripe confirma la elegibilidad, el primer pago y la renovación antes de suscribirte.",
    "How do I upgrade or downgrade?": "¿Cómo cambio de plan?",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "Abre Configuración → Facturación, elige el cambio y revisa el precio y la fecha de efecto antes de confirmar.",
    "Where do I manage my subscription?": "¿Dónde gestiono mi suscripción?",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "Abre Configuración → Facturación y elige Gestionar suscripción. Si el portal de Stripe no está disponible, usa la opción de soporte.",
    "What payment methods are accepted?": "¿Qué métodos de pago se aceptan?",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "Stripe muestra los métodos disponibles para tu cuenta, dispositivo y región. No todos están disponibles en todas partes.",
    "Why did my payment fail?": "¿Por qué falló mi pago?",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "Revisa los datos de facturación, el saldo y cualquier verificación del banco, y reintenta una vez. Si Stripe sigue rechazándolo, contacta con tu banco o con soporte.",
    "Where are invoices and receipts?": "¿Dónde están las facturas y recibos?",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "Abre Configuración → Facturación → Gestionar suscripción para verlas en Stripe. Si el portal no está disponible, escribe a soporte desde el correo de tu cuenta.",
    "Why was tax added?": "¿Por qué se añadieron impuestos?",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "Stripe calcula los impuestos según tus datos de facturación y las normas aplicables. Los precios publicados no incluyen impuestos.",
    "How do I update my payment method?": "¿Cómo actualizo mi método de pago?",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "Abre Configuración → Facturación → Gestionar suscripción y usa el portal de Stripe. Si no está disponible, contacta con soporte.",
    "Does my subscription renew automatically?": "¿Mi suscripción se renueva sola?",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "Consulta la fecha y condiciones de renovación en el pago y en el portal de Stripe.",
    "How do I cancel?": "¿Cómo cancelo?",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "Abre Configuración → Facturación → Gestionar suscripción y cancela en Stripe. Si no puedes hacerlo tú, escribe a soporte desde el correo de tu cuenta.",
    "What happens after cancellation?": "¿Qué pasa después de cancelar?",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "Stripe confirma la fecha de efecto. Tus chats no se borran por terminar la suscripción, pero las funciones de pago y los cupos mayores terminan al cambiar el plan.",
    "Are refunds available?": "¿Hay reembolsos?",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "Consulta la política de reembolso y contacta con soporte con el correo de tu cuenta y los datos de compra. No incluyas el número completo de la tarjeta.",
    "Why is my upgraded plan not showing?": "¿Por qué no aparece mi nuevo plan?",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "Actualiza Facturación, confirma que la compra se hizo con la misma cuenta y cierra e inicia sesión. No vuelvas a comprar mientras se procesa el pago; si sigue sin coincidir, contacta con soporte.",
    "How do usage limits work?": "¿Cómo funcionan los límites de uso?",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "El uso de Free es muy limitado. Plus amplía el uso y Pro tiene el mayor cupo. Varía según el modelo y la tarea. Todos los modelos tienen límites; consulta Uso para ver la próxima renovación.",
    "How does KovaGPT use my data?": "¿Cómo usa KovaGPT mis datos?",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "Consulta la política de privacidad para conocer la recogida, el tratamiento, los proveedores, la conservación y tus opciones.",
    "Are my conversations private?": "¿Mis conversaciones son privadas?",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "Los chats se vinculan a tu cuenta o dispositivo según el modo y la sincronización. No compartas secretos y revisa la política de privacidad y la vista previa antes de compartir.",
    "What happens to uploaded files?": "¿Qué pasa con los archivos subidos?",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "Se procesan y guardan según lo necesite el chat, proyecto o biblioteca. Elimínalos con los controles correspondientes y consulta la política de privacidad sobre su conservación.",
    "What data do integrations share?": "¿Qué datos comparten las integraciones?",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "La pantalla del proveedor muestra los permisos. El contenido y los detalles de la acción pueden enviarse al proveedor; revoca el acceso en Apps o con el proveedor.",
    "How do I export my data?": "¿Cómo exporto mis datos?",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "Abre Configuración y usa la opción de exportar datos. Espera a que termine; si no está disponible o falla, contacta con soporte.",
    "How do I delete my account?": "¿Cómo elimino mi cuenta?",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "Abre Configuración → Controles de datos y elige Programar eliminación. La cuenta y los datos se pueden recuperar durante 30 días con Recuperar cuenta. Programar o recuperar no cancela la facturación ni reinicia el descuento del primer mes; cancela aparte en Facturación si hace falta.",
    "What happens when I delete my account?": "¿Qué pasa cuando elimino mi cuenta?",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "Programarla abre un plazo de 30 días sin borrar nada. La limpieza final empieza después y verifica la baja de la suscripción y los datos privados antes de quitar la cuenta. Un estado pendiente no significa que haya terminado. Algunos registros de facturación, seguridad, legales, copias o proveedores pueden conservarse según la política de privacidad.",
    "Does KovaGPT support MFA?": "¿KovaGPT admite la verificación en dos pasos?",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "Puedes gestionarla en Configuración si tu método de acceso la admite.",
    "What should I do if someone accessed my account?": "¿Qué hago si alguien accedió a mi cuenta?",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "Protege primero tu correo o proveedor de identidad, cambia las credenciales, revoca sesiones o integraciones desconocidas, activa la verificación en dos pasos y contacta con soporte.",
    "Can support see my password?": "¿Soporte puede ver mi contraseña?",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "No. Nunca envíes contraseñas, códigos de un solo uso, llaves de acceso, códigos de recuperación ni el número completo de tu tarjeta.",
    "How do I contact KovaGPT about privacy?": "¿Cómo contacto con KovaGPT sobre privacidad?",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "Usa el formulario de abajo, elige Privacidad y seguridad y envíalo desde el correo de tu cuenta. También puedes escribir a support@kovagpt.com.",
    "What are Scheduled Tasks?": "¿Qué son las tareas programadas?",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "Son registros de flujos periódicos o por eventos. La ejecución en segundo plano no está disponible en esta versión; puedes seguir gestionando las tareas guardadas.",
    "Why can I not create a Scheduled Task?": "¿Por qué no puedo crear una tarea programada?",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "La ejecución programada no está disponible hasta conectar un programador aprobado y activo. Las tareas guardadas se pueden seguir gestionando.",
    "Can I edit, pause, or delete a saved task?": "¿Puedo editar, pausar o eliminar una tarea?",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "Abre Tareas programadas y usa los controles de cada tarea. Gestionarlas no activa la ejecución en segundo plano.",
    "KovaGPT is slow or not responding.": "KovaGPT va lento o no responde.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "Reintenta una vez, recarga, revisa tu conexión y cierra pestañas pesadas. Cierra e inicia sesión si procede, desactiva extensiones problemáticas y prueba otro navegador o dispositivo.",
    "A message is stuck on Thinking.": "Un mensaje se quedó en Pensando.",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "Detén la respuesta, reintenta una vez, recarga y revisa la conexión. Prueba una petición más corta o un modo más rápido; si se repite, contacta con soporte indicando la hora y el modo.",
    "My message failed to send.": "No se envió mi mensaje.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "Reintenta una vez, revisa la conexión y tu cupo y recarga. Quita adjuntos no compatibles, cierra e inicia sesión y prueba otro navegador antes de contactar con soporte.",
    "Search is not working.": "La búsqueda no funciona.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "Reintenta, confirma que Buscar está seleccionado y prueba una consulta pública normal. Recarga, revisa la conexión y el cupo, desactiva bloqueadores y contacta con soporte.",
    "An image will not generate.": "Una imagen no se genera.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "Reintenta con ajustes compatibles y un prompt que cumpla las normas. Revisa tu cupo y conexión, recarga y prueba otro navegador antes de contactar con soporte.",
    "Uploads keep failing.": "Las subidas siguen fallando.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "Confirma el tipo, el tamaño y el cupo, y reintenta de uno en uno. Recarga, revisa la conexión, quita extensiones que bloqueen subidas y prueba otro navegador.",
    "My subscription is not showing.": "Mi suscripción no aparece.",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "Actualiza Configuración → Facturación, verifica que estás en la cuenta de la compra y cierra e inicia sesión. No compres dos veces; si sigue sin aparecer, contacta con soporte con el recibo.",
    "The page looks broken or my sidebar disappeared.":
      "La página se ve mal o desapareció la barra lateral.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "Recarga y restablece el zoom, amplía la ventana o usa la navegación móvil. Desactiva extensiones que alteren páginas y prueba otro navegador.",
    "Why is a feature missing on another device?":
      "¿Por qué falta una función en otro dispositivo?",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "Confirma que ambos usan la misma cuenta, plan, versión y ajustes. Algunas funciones del navegador y datos locales dependen del dispositivo.",
    "I see an error message. What should I send support?": "Veo un error. ¿Qué envío a soporte?",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "Incluye el mensaje exacto, la página, la hora, lo que pulsaste, lo esperado, el navegador, el dispositivo y cualquier ID visible. Quita secretos y datos de pago de las capturas.",
    "How do I contact support?": "¿Cómo contacto con soporte?",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "Usa el formulario o escribe a support@kovagpt.com. Incluye el correo de la cuenta, la página, lo que pasó y lo que esperabas.",
    "How do I report a bug?": "¿Cómo informo de un error?",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "Elige Informe de error y describe los pasos, el resultado, lo esperado, el navegador, el dispositivo y cualquier error o ID.",
    "Can I request a feature?": "¿Puedo pedir una función?",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "Sí. Elige Solicitud de función y explica el problema que quieres resolver, sin enviar datos sensibles.",
    "What should I never send support?": "¿Qué nunca debo enviar a soporte?",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "Nunca envíes contraseñas, códigos de un solo uso, llaves de acceso, códigos de recuperación, secretos de API ni números completos de tarjeta.",
    "What is included in Free?": "¿Qué incluye Free?",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "Prueba KovaGPT con un uso muy limitado. Argon Lite y Medio (Pensando). Organiza chats en Proyectos. Encuentra archivos e imágenes en la biblioteca. Uso de chat muy limitado; hay límites en todos los modelos. Generación de imágenes y subidas limitadas. Almacenamiento en la nube incluido. Búsqueda e imágenes cuando sus proveedores estén disponibles. Memoria básica si está activada.",
    "What is included in Plus?": "¿Qué incluye Plus?",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "Uso ampliado con los siete modelos hasta Máx.: Lite, Medio, Alto, Extra alto y Máx. Hay límites en todos los modelos. Organiza chats en Proyectos y encuentra archivos e imágenes en la biblioteca. Más generación de imágenes y subidas. Almacenamiento en la nube incluido. Búsqueda e imágenes cuando sus proveedores estén disponibles. Memoria mejorada si está activada.",
    "What is included in Pro?": "¿Qué incluye Pro?",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "Nuestro mayor uso con los siete modelos hasta Ultra: Lite, Medio, Alto, Extra alto, Máx. y Ultra. Hay límites en todos los modelos. Organiza chats en Proyectos y encuentra archivos e imágenes en la biblioteca. Más generación de imágenes y subidas. Almacenamiento en la nube incluido. Búsqueda e imágenes cuando sus proveedores estén disponibles. Memoria ampliada si está activada.",
    "Getting started": "Primeros pasos",
    "Account & sign-in": "Cuenta e inicio de sesión",
    "Chat & modes": "Chat y modos",
    "Search & research": "Búsqueda e investigación",
    "Files & images": "Archivos e imágenes",
    "Library & sharing": "Biblioteca y compartir",
    "Apps & integrations": "Apps e integraciones",
    "Local places": "Lugares locales",
    "Settings & memory": "Configuración y memoria",
    "Billing & plans": "Facturación y planes",
    "Privacy & security": "Privacidad y seguridad",
    Troubleshooting: "Solución de problemas",
    "Contact & support": "Contacto y soporte",
    "Help categories": "Categorías de ayuda",
    Back: "Atrás",
    "KovaGPT Help Center": "Centro de ayuda de KovaGPT",
    "How can we help?": "¿Cómo podemos ayudarte?",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "Busca respuestas, explora temas frecuentes o contacta con el soporte de KovaGPT.",
    "Search help…": "Buscar en la ayuda…",
    "Search help": "Buscar en la ayuda",
    "Try a different search or send us a message below.":
      "Prueba otra búsqueda o envíanos un mensaje abajo.",
    "Show more answers": "Mostrar más respuestas",
    "Find a fix for your setup": "Encuentra una solución para tu caso",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "Elige el problema, el navegador, la conexión, el plan y cuándo empezó para ver pasos concretos. Combinan artículos de ayuda con comprobaciones; no son informes de cada problema posible.",
    "Your issue": "Tu problema",
    "Help issue": "Problema",
    "Browser & device": "Navegador y dispositivo",
    "Help browser": "Navegador",
    Connection: "Conexión",
    "Help connection": "Conexión",
    "Kova plan": "Plan de Kova",
    "Help plan": "Plan",
    "When it started": "Cuándo empezó",
    "Help stage": "Momento",
    "Troubleshooting steps": "Pasos para solucionarlo",
    "Loading support form…": "Cargando formulario…",
    "Request accepted": "Solicitud recibida",
    "Send another message": "Enviar otro mensaje",
    "Still need help?": "¿Aún necesitas ayuda?",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "¿No encuentras la respuesta? Escribe al soporte de KovaGPT y te responderemos por correo.",
    Optional: "Opcional",
    Topic: "Tema",
    "Choose a topic": "Elige un tema",
    "Tell us what happened, what you expected, and any error message you saw.":
      "Cuéntanos qué pasó, qué esperabas y cualquier mensaje de error.",
    "We’ll use your email only to respond to this support request.":
      "Solo usaremos tu correo para responder a esta solicitud.",
    "Sending…": "Enviando…",
    "Support request status": "Estado de la solicitud",
    "Your message is still here.": "Tu mensaje sigue aquí.",
    Features: "Funciones",
    Learn: "Aprender",
    Business: "Empresas",
    Pricing: "Precios",
    Review: "Opiniones",
    "Open KovaGPT": "Abrir KovaGPT",
    "Open app": "Abrir app",
    "All projects": "Todos los proyectos",
    "My projects": "Mis proyectos",
    "Shared with me": "Compartidos conmigo",
    "Browse answers": "Explorar respuestas",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      "Prueba «cancelar suscripción», «no puedo iniciar sesión», «lento» o «Google mail».",
  },
  fr: {
    "Why is Thinking blue?": "Pourquoi Réflexion est-il en bleu ?",
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      "Le cerveau et le libellé Réflexion passent au bleu quand le raisonnement approfondi est activé. Cliquez à nouveau pour revenir au mode par défaut. Free propose un simple interrupteur ; Plus et Pro offrent des niveaux de modèle supplémentaires.",
    "How do I resize or color the sidebar?":
      "Comment redimensionner ou colorer la barre latérale ?",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "Sur ordinateur, faites glisser le bord droit de la barre latérale. Vous pouvez aussi le sélectionner et appuyer sur Gauche ou Droite ; Début et Fin appliquent la largeur minimale et maximale. Ouvrez Plus → Personnaliser la barre latérale pour choisir éléments, couleur, position de la recherche et discussions récentes. Vos choix sont enregistrés pour ce compte dans ce navigateur.",
    "How do I copy or remove a chat link?": "Comment copier ou supprimer un lien de discussion ?",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "Choisissez Partager dans une discussion enregistrée pour copier son lien public. Toute personne disposant du lien peut lire cet instantané pendant 30 jours ; fichiers et futurs messages exclus. Révoquez un lien dans Paramètres → Contrôle des données. La confirmation n'apparaît que si le presse-papiers accepte le lien.",
    "The clipboard won't copy a share link.": "Le presse-papiers ne copie pas le lien.",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "Si le presse-papiers échoue, le lien s'affiche dans une fenêtre. Sélectionnez-le pour le copier manuellement ou choisissez Copier le lien pour réessayer.",
    "Which image shapes and custom sizes can I use?":
      "Quels formats et tailles d'image puis-je utiliser ?",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "Choisissez Carré 1:1, Paysage 3:2, Portrait 2:3, Panoramique 16:9, Story 9:16 ou Personnalisé avec un modèle compatible. Les côtés personnalisés doivent être des multiples de 16, au plus 3840 pixels, avec 655 360 à 8 294 400 pixels au total et un ratio de 1:3 à 3:1. Les grands formats peuvent prendre plus de temps.",
    "How do I create an image in a normal chat?": "Comment créer une image dans une discussion ?",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "Ouvrez le menu + et choisissez Créer une image, décrivez ce que vous voulez puis envoyez. Il faut être connecté et disposer d'un quota d'images. Le résultat reste dans la discussion et peut être enregistré dans la bibliothèque.",
    "Why doesn't the activity panel show Cloud browser?":
      "Pourquoi le panneau d'activité n'affiche-t-il pas le navigateur cloud ?",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "Le panneau affiche les sources et sorties enregistrées de cette discussion. L'aperçu et le nombre d'onglets apparaissent quand une intégration de navigateur fournit de vraies données de session. Une simple recherche web ne signifie pas qu'un navigateur cloud est actif.",
    "How much usage does each plan include?": "Quelle utilisation comprend chaque forfait ?",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "Free offre une utilisation très limitée. Plus coûte 16 $ par mois avec une utilisation étendue. Pro coûte 80 $ par mois avec notre quota le plus élevé. L'utilisation varie selon le modèle et la tâche, et des limites s'appliquent à tous les modèles.",
    "Scheduled tasks says access could not be verified.":
      "Les tâches planifiées indiquent que l'accès n'a pas pu être vérifié.",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "Rechargez une fois et vérifiez que le même compte est connecté. Si le problème persiste, l'assistance doit vérifier le schéma des tâches et les fonctions d'accès. Un rechargement ne répare pas une migration de base de données manquante. Ne supprimez pas vos tâches pour contourner le problème.",
    "My task is saved but background execution isn't ready.":
      "Ma tâche est enregistrée mais l'exécution en arrière-plan n'est pas prête.",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "Vérifiez l'état et le fuseau horaire de la tâche. L'exécution planifiée nécessite un fournisseur configuré, une politique approuvée et un planificateur opérationnel. Si la page signale un problème de service, gardez la tâche et contactez l'assistance ; relancer plusieurs fois peut créer des doublons.",
    "What is KovaGPT?": "Qu'est-ce que KovaGPT ?",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "KovaGPT est un espace de travail IA pour les discussions, la recherche web, les fichiers, les images, les projets et les apps connectées. La disponibilité dépend de votre forfait et des fournisseurs configurés.",
    "What should I try first?": "Par quoi commencer ?",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "Lancez une discussion et posez une question précise ou décrivez le résultat voulu. Pour un travail suivi, choisissez Projets dans la barre latérale afin de regrouper discussions, instructions et fichiers.",
    "How do I start a new chat?": "Comment démarrer une nouvelle discussion ?",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "Sélectionnez Nouvelle discussion dans la barre latérale. Choisissez un mode ou un outil, saisissez votre message et envoyez-le.",
    "Where are my previous chats?": "Où sont mes discussions précédentes ?",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "Les discussions normales se synchronisent avec votre compte quand la synchronisation est disponible. Les modifications hors ligne restent sur l'appareil jusqu'à confirmation ; la discussion temporaire n'apparaît pas dans l'historique.",
    "Can I use KovaGPT without an account?": "Puis-je utiliser KovaGPT sans compte ?",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "Un compte vérifié est nécessaire pour discuter, créer ou modifier des images, gérer la bibliothèque et utiliser les outils. Choisissez Se connecter ou Créer un compte. L'aide, les tarifs, les informations légales et les liens partagés en lecture seule sont publics.",
    "Does KovaGPT work on mobile?": "KovaGPT fonctionne-t-il sur mobile ?",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "Oui. KovaGPT s'adapte à tous les écrans et peut être installé comme app web si le navigateur le permet.",
    "Which browsers are supported?": "Quels navigateurs sont pris en charge ?",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "Utilisez une version récente d'un navigateur moderne. S'il manque une fonction (clés d'accès, installation, notifications), mettez-le à jour ou essayez-en un autre.",
    "How do I create an account?": "Comment créer un compte ?",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "Choisissez Se connecter, puis continuez avec un fournisseur disponible ou votre e-mail. L'écran n'affiche que les méthodes activées.",
    "How do I change my display name or profile image?":
      "Comment changer mon nom affiché ou ma photo ?",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "Ouvrez le menu de profil → Paramètres → Compte et modifiez les champs disponibles. Les informations gérées par un fournisseur se modifient chez lui.",
    "How do I change my password?": "Comment changer mon mot de passe ?",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "Choisissez Mot de passe oublié sur l'écran de connexion par e-mail. Les comptes créés avec Google ou un autre fournisseur gèrent leur mot de passe chez lui.",
    "How does Google sign-in work?": "Comment fonctionne la connexion Google ?",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "Choisissez Continuer avec Google et approuvez la demande. KovaGPT ne reçoit pas votre mot de passe Google.",
    "Why did Google sign-in fail?": "Pourquoi la connexion Google a-t-elle échoué ?",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "Réessayez, actualisez la page, autorisez la fenêtre de connexion et vérifiez que les cookies ne sont pas bloqués. Essayez ensuite un autre navigateur et contactez l'assistance si le problème persiste.",
    "I cannot sign in. What should I try?": "Je ne peux pas me connecter. Que faire ?",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "Réessayez une fois, actualisez, vérifiez votre connexion et demandez un nouvel e-mail de connexion ou de réinitialisation. Vérifiez les bloqueurs, puis essayez un autre navigateur ou appareil avant de contacter l'assistance.",
    "Why did my sign-in email not arrive?": "Pourquoi n'ai-je pas reçu l'e-mail de connexion ?",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "Vérifiez les spams et Promotions, confirmez l'adresse et demandez un nouvel e-mail. Utilisez uniquement le lien le plus récent : les anciens peuvent ne plus fonctionner.",
    "Does KovaGPT support passkeys?": "KovaGPT prend-il en charge les clés d'accès ?",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "La connexion par clé d'accès est disponible si elle est activée et prise en charge par votre navigateur et appareil. Gérez vos clés dans les Paramètres.",
    "How do I send a message?": "Comment envoyer un message ?",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "Écrivez dans la zone de saisie et sélectionnez Envoyer, ou utilisez le raccourci clavier. Joignez du contexte avant l'envoi si besoin.",
    "How do I stop a response?": "Comment arrêter une réponse ?",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "Utilisez le bouton d'arrêt qui remplace Envoyer pendant la génération. Le contenu déjà reçu est conservé.",
    "Can I regenerate an answer?": "Puis-je régénérer une réponse ?",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "Utilisez l'action Réessayer sur une réponse terminée ou échouée quand elle s'affiche. Le nouveau résultat peut différer : vérifiez les points importants.",
    "Can I edit a previous message?": "Puis-je modifier un message précédent ?",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "Utilisez l'action Modifier sur votre message. La modification crée un nouveau fil à partir de ce point ; la suite peut changer.",
    "How do I copy an answer?": "Comment copier une réponse ?",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "Utilisez l'action Copier de la réponse. Pour les éléments générés, utilisez l'éditeur ou l'export.",
    "How do I rename or delete a conversation?": "Comment renommer ou supprimer une discussion ?",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "Ouvrez le menu de la discussion dans l'historique et choisissez Renommer ou Supprimer. Confirmez avec soin : la suppression peut être définitive.",
    "Why can KovaGPT make mistakes?": "Pourquoi KovaGPT peut-il se tromper ?",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "Les réponses de l'IA peuvent être incomplètes ou inexactes. Vérifiez les affirmations, calculs et sources importants, surtout pour les décisions médicales, juridiques, financières ou de sécurité.",
    "Does a new chat remember an earlier chat?":
      "Une nouvelle discussion se souvient-elle d'une précédente ?",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "Seule la mémoire adaptative peut transmettre du contexte entre discussions ; elle est disponible pour les abonnés Plus et Pro connectés si elle est activée. Sinon, chaque discussion démarre avec son propre contexte.",
    "Why did a long conversation lose context?":
      "Pourquoi une longue discussion a-t-elle perdu le contexte ?",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "Les très longues discussions peuvent dépasser le contexte du modèle. Rappelez les détails importants, joignez une source concise ou démarrez une nouvelle discussion avec un résumé.",
    "What is Lite mode?": "Qu'est-ce que le mode Lite ?",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      "Le mode par défaut est le plus rapide. Sur Free, le bouton Réflexion en forme de cerveau active un raisonnement plus poussé ou revient au défaut. Plus ajoute Moyen et Élevé ; Pro ajoute Très élevé, Max et Ultra. Un compte est requis.",
    "What is Medium mode?": "Qu'est-ce que le mode Moyen ?",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "Moyen accorde au même modèle plus de temps que Lite. Disponible sur Plus et Pro.",
    "What is Thinking mode?": "Qu'est-ce que le mode Réflexion ?",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "Réflexion est le nom sur Plus du mode à effort élevé. Il utilise le même modèle avec plus de temps que Moyen.",
    "What is High mode?": "Qu'est-ce que le mode Élevé ?",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "Élevé est le nom sur Pro de ce mode à effort élevé. Disponible sur Pro.",
    "What is Extra High mode?": "Qu'est-ce que le mode Très élevé ?",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "Très élevé accorde au même modèle plus de temps limité pour analyser, vérifier et réviser. Disponible sur Pro.",
    "What is Max mode?": "Qu'est-ce que le mode Max ?",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "Max utilise un budget de travail plus important avec le même modèle pour les demandes difficiles. Disponible sur Pro.",
    "What is Ultra mode?": "Qu'est-ce que le mode Ultra ?",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "Ultra est le niveau le plus poussé de Pro et peut orchestrer des sous-agents limités sur le même modèle.",
    "Which modes are on each plan?": "Quels modes comprend chaque forfait ?",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "Free comprend Lite et Moyen. Plus comprend Lite, Moyen, Élevé, Très élevé et Max. Pro comprend Lite, Moyen, Élevé, Très élevé, Max et Ultra. Les anciennes générations de Kova restent disponibles pour les travaux existants.",
    "Why do I not see every mode?": "Pourquoi ne vois-je pas tous les modes ?",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "Les modes dépendent de votre forfait et de la disponibilité du service. Actualisez après un changement de forfait ; si la facturation affiche le nouveau forfait mais que le mode manque, déconnectez-vous puis reconnectez-vous, et contactez l'assistance.",
    "Do more capable modes take longer?": "Les modes plus puissants prennent-ils plus de temps ?",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "C'est possible. Les modes plus poussés peuvent prendre plus de temps que Lite ou Moyen, surtout pour les demandes complexes.",
    "What does Search do?": "Que fait la recherche ?",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "La recherche récupère des sources web actuelles quand les fournisseurs sont disponibles. Ouvrez les liens cités et vérifiez qu'ils appuient la réponse.",
    "When should I use Search?": "Quand utiliser la recherche ?",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "Utilisez-la pour l'actualité, les informations récentes sur des produits, des données publiques en direct ou chaque fois que vous voulez des sources. Inutile en général pour réécrire ou pour des questions sur un texte fourni.",
    "Does Search browse the live web?": "La recherche parcourt-elle le web en direct ?",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "La recherche peut récupérer des sources actuelles quand ses fournisseurs sont disponibles. Les pages liées font foi.",
    "Can KovaGPT cite sources?": "KovaGPT peut-il citer ses sources ?",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "La recherche peut renvoyer des sources liées. Ouvrez chaque citation et vérifiez qu'elle appuie l'affirmation.",
    "Why might two searches differ?": "Pourquoi deux recherches peuvent-elles différer ?",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "Les pages et classements changent, et une autre formulation peut trouver d'autres éléments. Comparez les citations plutôt que de vous fier au seul résumé.",
    "Why is Search unavailable?": "Pourquoi la recherche est-elle indisponible ?",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "La recherche dépend des fournisseurs et de votre quota. Actualisez, vérifiez que l'outil est sélectionné et réessayez ; sinon, contactez l'assistance.",
    "What files can I upload to chat?": "Quels fichiers puis-je importer ?",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "Le chat accepte texte, code, CSV, JSON et images, et extrait le texte lisible des PDF, DOCX, XLSX et PPTX pris en charge. Les connaissances du projet indexent les fichiers texte compatibles. L'extraction est limitée à 10 Mo et peut omettre la mise en forme, le contenu numérisé ou les pages illisibles. L'aperçu du PDF original est distinct du texte extrait ; les originaux Office sont téléchargeables mais pas affichés.",
    "How do I upload a file?": "Comment importer un fichier ?",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "Utilisez le bouton de pièce jointe et choisissez un fichier pris en charge. Attendez qu'il soit prêt avant d'envoyer.",
    "Why did my upload fail?": "Pourquoi l'importation a-t-elle échoué ?",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "Réessayez, vérifiez le type et la taille, votre connexion et votre quota. Actualisez et essayez un fichier à la fois ; en cas d'échec, contactez l'assistance avec le type de fichier et l'erreur.",
    "Can KovaGPT analyze spreadsheets?": "KovaGPT peut-il analyser des tableurs ?",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "KovaGPT peut raisonner sur du texte, CSV, JSON et des images, et présenter des tableaux ou graphiques. Il ne fournit pas d'environnement d'exécution de tableurs ou de code importé.",
    "Can KovaGPT understand uploaded images?": "KovaGPT comprend-il les images importées ?",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "Le chat accepte les images prises en charge et analyse leur contenu visible. Il peut manquer du petit texte ou des détails ambigus ; vérifiez avec l'original.",
    "Are file limits different by plan?": "Les limites de fichiers dépendent-elles du forfait ?",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "Oui. Les quotas d'importation et de stockage augmentent selon le forfait. Consultez les tarifs et l'utilisation affichée dans le produit.",
    "Can I remove a file before sending?": "Puis-je retirer un fichier avant l'envoi ?",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "Oui. Utilisez le bouton Retirer sur l'aperçu de la pièce jointe avant d'envoyer.",
    "How do I generate an image?": "Comment générer une image ?",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "Ouvrez Images, décrivez le sujet, la composition et le style, choisissez les réglages et générez. Vous devez être connecté et disposer d'un quota.",
    "How should I describe the image I want?": "Comment décrire l'image souhaitée ?",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "Précisez le sujet, le décor, la composition, l'éclairage, la technique et les exclusions. Des contraintes claires valent mieux qu'une liste d'adjectifs vagues.",
    "Can I edit an existing image?": "Puis-je modifier une image existante ?",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "Modifiez une image de la bibliothèque avec un modèle compatible. Un masque PNG transparent facultatif peut guider la modification. Les quotas s'appliquent.",
    "Why was an image request rejected?": "Pourquoi ma demande d'image a-t-elle été refusée ?",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "Une demande peut être refusée pour des raisons de sécurité, des réglages invalides, une image source non prise en charge ou l'indisponibilité du fournisseur. Reformulez sans contenu interdit et utilisez des réglages pris en charge.",
    "Why is image generation slow?": "Pourquoi la génération d'images est-elle lente ?",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "La durée dépend de la charge du fournisseur et des réglages. Gardez la page ouverte, ne réessayez qu'après une erreur et évitez les doublons.",
    "Are image limits plan dependent?": "Les limites d'images dépendent-elles du forfait ?",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "Oui. Chaque forfait a un quota quotidien d'images, plus élevé sur les forfaits payants.",
    "What is Canvas?": "Qu'est-ce que Canvas ?",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "Les textes, codes et sites générés peuvent s'ouvrir dans un éditeur avec export et versions de session. Les versions disparaissent à la fermeture de l'éditeur.",
    "What are Projects?": "Que sont les projets ?",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "Les projets regroupent discussions, fichiers, images, notes, tâches, mémoire du projet et instructions.",
    "How do I create a project?": "Comment créer un projet ?",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "Sélectionnez Projets dans la barre latérale, choisissez Nouveau projet, renseignez les informations et créez-le.",
    "How do I rename a project?": "Comment renommer un projet ?",
    "Open the project and use its settings or project menu to update the name.":
      "Ouvrez le projet et utilisez ses paramètres ou son menu pour modifier le nom.",
    "How do I delete a project?": "Comment supprimer un projet ?",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "Ouvrez les paramètres du projet, choisissez Supprimer le projet et confirmez. Ses enregistrements et fichiers sont aussi supprimés ; lisez bien la confirmation.",
    "How do I add chats to a project?": "Comment ajouter des discussions à un projet ?",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "Démarrez une discussion depuis le projet. Si l'option Déplacer est proposée, vous pouvez aussi y affecter une discussion existante.",
    "Can I upload files to a project?": "Puis-je importer des fichiers dans un projet ?",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "Oui. Les connaissances du projet acceptent les fichiers pris en charge, dans la limite de vos quotas.",
    "Does project context carry across chats?":
      "Le contexte du projet s'applique-t-il à toutes ses discussions ?",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "Les instructions, connaissances, notes et la mémoire du projet peuvent fournir du contexte à ses discussions. Gardez les consignes essentielles explicites et vérifiez les résultats importants.",
    "Can I share a project?": "Puis-je partager un projet ?",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "Les propriétaires peuvent ouvrir Membres et inviter des collaborateurs, si le service de collaboration est disponible.",
    "How do project invitations work?": "Comment fonctionnent les invitations ?",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "Le propriétaire envoie une invitation à une adresse e-mail. Le destinataire se connecte avec cette identité et accepte avant d'accéder au projet.",
    "Can someone without an account accept a project invitation?":
      "Une personne sans compte peut-elle accepter une invitation ?",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "Il lui faut un compte KovaGPT associé à l'identité invitée pour participer.",
    "What happens when a collaborator is removed?":
      "Que se passe-t-il si un collaborateur est retiré ?",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "Son accès est révoqué. Le contenu déjà copié ou exporté n'est pas récupéré.",
    "Can I leave a shared project?": "Puis-je quitter un projet partagé ?",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "Demandez au propriétaire de vous retirer. Il conserve le projet et son contenu.",
    "Who owns a shared project?": "À qui appartient un projet partagé ?",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "Le compte qui l'a créé reste propriétaire, sauf changement explicitement confirmé.",
    "What is Library?": "Qu'est-ce que la bibliothèque ?",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "La bibliothèque contient ce que vous enregistrez ou importez ; ce n'est pas une copie automatique de chaque discussion.",
    "How do I save something to Library?": "Comment enregistrer dans la bibliothèque ?",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "Utilisez Enregistrer dans la bibliothèque sur une réponse, image ou fichier. Seuls les éléments enregistrés ou importés y apparaissent.",
    "Can I reopen or remove a Library item?": "Puis-je rouvrir ou retirer un élément ?",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "Ouvrez la bibliothèque, sélectionnez l'élément pour le rouvrir ou utilisez Supprimer. Confirmez avec soin.",
    "Can I organize Library items?": "Puis-je organiser la bibliothèque ?",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "Oui. Des dossiers et des déplacements groupés permettent d'organiser les éléments.",
    "How do I share a chat?": "Comment partager une discussion ?",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "Utilisez Partager dans la discussion. Vérifiez l'aperçu et l'accès avant de créer ou d'envoyer le lien.",
    "Does a shared chat update automatically?": "Une discussion partagée se met-elle à jour ?",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "L'aperçu du partage indique ce que verront les destinataires. Revérifiez-le après avoir modifié la discussion.",
    "Which apps can I connect?": "Quelles apps puis-je connecter ?",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "La page Apps propose Google, Gmail, Google Drive, Google Agenda et GitHub. Chaque connexion dépend des identifiants, des autorisations accordées et de la disponibilité du service.",
    "How do I connect an app?": "Comment connecter une app ?",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "Ouvrez Apps, choisissez un fournisseur et lisez l'écran de consentement. N'approuvez que les autorisations comprises.",
    "How do I disconnect or reconnect an app?": "Comment déconnecter ou reconnecter une app ?",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "Ouvrez Apps, sélectionnez le service et choisissez Déconnecter. Pour reconnecter, relancez la connexion et approuvez les autorisations.",
    "Why does an integration ask for permission?":
      "Pourquoi une intégration demande-t-elle des autorisations ?",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "L'écran du fournisseur liste les autorisations nécessaires. KovaGPT n'utilise que l'accès accordé.",
    "What happens when I revoke access?": "Que se passe-t-il si je révoque l'accès ?",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "Les nouvelles actions cessent de fonctionner. Les données déjà importées ne sont pas supprimées automatiquement ; supprimez-les séparément si besoin.",
    "Why did a connected app stop working?":
      "Pourquoi une app connectée ne fonctionne-t-elle plus ?",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "Réessayez, vérifiez l'état et les autorisations dans Apps, puis déconnectez et reconnectez si nécessaire. Une panne du fournisseur ou la configuration peut aussi bloquer une action.",
    "How does Gmail integration work?": "Comment fonctionne l'intégration Gmail ?",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "Connectez Gmail depuis Apps. Les actions de lecture ou d'écriture dépendent des autorisations, identifiants et de la disponibilité.",
    "Can KovaGPT search my email or read attachments?":
      "KovaGPT peut-il chercher dans mes e-mails ou lire les pièces jointes ?",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "Il ne peut effectuer que les actions Gmail autorisées par la connexion. Vérifiez l'action et la source avant de vous y fier.",
    "Can KovaGPT draft or send email?": "KovaGPT peut-il rédiger ou envoyer des e-mails ?",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "Les actions d'écriture Gmail nécessitent une confirmation explicite. KovaGPT n'envoie jamais d'e-mail en silence.",
    "Can KovaGPT check or change my calendar?":
      "KovaGPT peut-il consulter ou modifier mon agenda ?",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "Google Agenda peut lire ou écrire selon les autorisations accordées. Créer ou modifier un événement nécessite une confirmation.",
    "Can KovaGPT search Google Drive?": "KovaGPT peut-il chercher dans Google Drive ?",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "Google Drive se connecte depuis Apps. La recherche et la lecture dépendent des autorisations, des fichiers pris en charge et de la disponibilité.",
    "Can KovaGPT modify Drive files?": "KovaGPT peut-il modifier des fichiers Drive ?",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "Ne supposez pas une modification générale de Drive. Seules les actions proposées à confirmation et prises en charge peuvent s'exécuter.",
    "How does GitHub integration work?": "Comment fonctionne l'intégration GitHub ?",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "Connectez GitHub depuis Apps et vérifiez ses autorisations. Les actions sur les dépôts dépendent de l'accès accordé.",
    "What is Local places?": "Qu'est-ce que Lieux locaux ?",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "Lieux locaux est l'expérience Cartes prévue dans KovaGPT. Elle reste indisponible jusqu'à validation du fournisseur, du juridique, de la confidentialité, de la capacité et des coûts.",
    "Can it search real places?": "Peut-il rechercher de vrais lieux ?",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "Pas dans la version actuelle. Si Cartes est approuvé, il pourra interroger un fournisseur tiers vérifié ; vérifiez toujours les fiches avant de vous déplacer.",
    "Can it provide directions?": "Peut-il donner un itinéraire ?",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "KovaGPT peut ouvrir une carte externe pour l'itinéraire. Il ne propose pas sa propre navigation pas à pas.",
    "Does KovaGPT use my device location?": "KovaGPT utilise-t-il la position de mon appareil ?",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "Pas tant que Cartes est indisponible. S'il est approuvé, KovaGPT ne demandera vos coordonnées qu'après votre choix explicite et indiquera les fournisseurs qui les reçoivent. Cartes n'enregistre pas de coordonnées dans les paramètres.",
    "Why is Local places unavailable?": "Pourquoi Lieux locaux est-il indisponible ?",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "Cartes est volontairement désactivé en attendant les validations (fournisseur, licences, attribution, confidentialité, capacité, coûts). Dans cet état, il ne demande pas la position et n'appelle aucun fournisseur.",
    "Where are Settings?": "Où sont les paramètres ?",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "Ouvrez le menu de profil et choisissez Paramètres : compte, personnalisation, mémoire, apps, abonnement, confidentialité et apparence selon le cas.",
    "How do I change appearance?": "Comment changer l'apparence ?",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "Ouvrez le menu de profil → Paramètres → Apparence et choisissez un thème.",
    "Can I change how KovaGPT responds?": "Puis-je changer la façon dont KovaGPT répond ?",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "Utilisez la personnalisation et des instructions explicites dans la discussion ou un projet. KovaGPT les applique aux réponses suivantes.",
    "What is Adaptive Memory?": "Qu'est-ce que la mémoire adaptative ?",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "La mémoire est disponible sur Free, avec plus de capacité sur Plus et Pro. Les mises à jour depuis les discussions sont facultatives ; les notes peuvent être modifiées ou supprimées. Les discussions temporaires ne l'utilisent jamais.",
    "How do I turn Memory off or delete it?": "Comment désactiver ou supprimer la mémoire ?",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "Ouvrez Paramètres → Mémoire. Désactivez-la pour bloquer son utilisation, ou choisissez Supprimer la mémoire enregistrée.",
    "Is Memory the same as chat history?": "La mémoire est-elle l'historique des discussions ?",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "Non. L'historique conserve les discussions ; la mémoire adaptative conserve un contexte choisi entre discussions. La désactiver ou la supprimer n'efface ni l'historique ni les brouillons.",
    "Does Temporary Chat use Memory?": "La discussion temporaire utilise-t-elle la mémoire ?",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "Non. La discussion temporaire n'utilise ni ne met à jour la mémoire et n'apparaît pas dans l'historique.",
    "How do notifications work?": "Comment fonctionnent les notifications ?",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "Ouvrez Notifications pour consulter les avis. Les notifications push nécessitent un navigateur compatible, une autorisation et une configuration.",
    "What plans does KovaGPT offer?": "Quels forfaits propose KovaGPT ?",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "KovaGPT propose Free, Plus et Pro. Les besoins entreprise se discutent séparément ; le périmètre et les conditions sont confirmés avant l'achat.",
    "How much do Plus and Pro cost?": "Combien coûtent Plus et Pro ?",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "Les prix mensuels sont de 16 USD pour Plus et 80 USD pour Pro, hors taxes. Confirmez le montant final dans Stripe avant l'achat.",
    "How does the first-month discount work?": "Comment fonctionne la réduction du premier mois ?",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "Les comptes éligibles bénéficient de 50 % sur le premier mois de Plus ou Pro mensuel, une fois par compte. Ensuite, le prix normal s'applique. Les nouveaux abonnements n'ont pas d'essai gratuit ; les essais existants gardent leurs conditions. Stripe confirme l'éligibilité, le premier paiement et le renouvellement avant l'abonnement.",
    "How do I upgrade or downgrade?": "Comment changer de forfait ?",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "Ouvrez Paramètres → Facturation, choisissez le changement et vérifiez le prix et la date d'effet avant de confirmer.",
    "Where do I manage my subscription?": "Où gérer mon abonnement ?",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "Ouvrez Paramètres → Facturation et choisissez Gérer l'abonnement. Si le portail Stripe n'est pas disponible, utilisez l'option d'assistance.",
    "What payment methods are accepted?": "Quels moyens de paiement sont acceptés ?",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "Stripe affiche les moyens disponibles selon votre compte, appareil et région. Tous ne sont pas proposés partout.",
    "Why did my payment fail?": "Pourquoi mon paiement a-t-il échoué ?",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "Vérifiez les informations, le solde et toute authentification bancaire, puis réessayez une fois. Si Stripe refuse encore, contactez votre banque ou l'assistance.",
    "Where are invoices and receipts?": "Où trouver factures et reçus ?",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "Ouvrez Paramètres → Facturation → Gérer l'abonnement pour les voir dans Stripe. Si le portail est indisponible, contactez l'assistance depuis l'e-mail du compte.",
    "Why was tax added?": "Pourquoi des taxes ont-elles été ajoutées ?",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "Stripe calcule les taxes selon vos informations de facturation et les règles applicables. Les prix publiés sont hors taxes.",
    "How do I update my payment method?": "Comment modifier mon moyen de paiement ?",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "Ouvrez Paramètres → Facturation → Gérer l'abonnement et utilisez le portail Stripe. Sinon, contactez l'assistance.",
    "Does my subscription renew automatically?":
      "Mon abonnement se renouvelle-t-il automatiquement ?",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "Consultez la date et les conditions de renouvellement dans le paiement et le portail Stripe.",
    "How do I cancel?": "Comment résilier ?",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "Ouvrez Paramètres → Facturation → Gérer l'abonnement et résiliez dans Stripe. Sinon, contactez l'assistance depuis l'e-mail du compte.",
    "What happens after cancellation?": "Que se passe-t-il après la résiliation ?",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "Stripe confirme la date d'effet. Vos discussions ne sont pas supprimées, mais les fonctions payantes et quotas supérieurs prennent fin au changement de forfait.",
    "Are refunds available?": "Les remboursements sont-ils possibles ?",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "Consultez la politique de remboursement, puis contactez l'assistance avec l'e-mail du compte et les détails d'achat. N'indiquez pas le numéro complet de la carte.",
    "Why is my upgraded plan not showing?": "Pourquoi mon nouveau forfait n'apparaît-il pas ?",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "Actualisez la facturation, vérifiez que l'achat concerne le même compte, puis reconnectez-vous. N'achetez pas à nouveau pendant le traitement ; contactez l'assistance si l'écart persiste.",
    "How do usage limits work?": "Comment fonctionnent les limites d'utilisation ?",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "L'utilisation Free est très limitée. Plus l'élargit et Pro offre notre quota le plus élevé. Elle varie selon le modèle et la tâche. Tous les modèles ont des limites ; consultez Utilisation pour le prochain renouvellement.",
    "How does KovaGPT use my data?": "Comment KovaGPT utilise-t-il mes données ?",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "Consultez la politique de confidentialité pour la collecte, le traitement, les fournisseurs, la conservation et vos choix.",
    "Are my conversations private?": "Mes discussions sont-elles privées ?",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "Les discussions sont liées à votre compte ou appareil selon le mode et la synchronisation. N'y mettez pas de secrets et vérifiez la politique de confidentialité et l'aperçu avant de partager.",
    "What happens to uploaded files?": "Que deviennent les fichiers importés ?",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "Ils sont traités et stockés selon la fonction utilisée (discussion, projet, bibliothèque). Supprimez-les avec les commandes prévues et consultez la politique de confidentialité pour la conservation.",
    "What data do integrations share?": "Quelles données les intégrations partagent-elles ?",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "L'écran du fournisseur liste les autorisations. Le contenu et les détails de l'action peuvent lui être envoyés ; révoquez l'accès dans Apps ou chez le fournisseur.",
    "How do I export my data?": "Comment exporter mes données ?",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "Ouvrez les Paramètres et utilisez l'export de données. Attendez la fin ; contactez l'assistance si l'option manque ou échoue.",
    "How do I delete my account?": "Comment supprimer mon compte ?",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "Ouvrez Paramètres → Contrôle des données et choisissez Planifier la suppression. Le compte reste récupérable 30 jours via Récupérer le compte. Planifier ou récupérer n'annule pas la facturation ni ne réinitialise la réduction ; résiliez séparément dans Facturation si besoin.",
    "What happens when I delete my account?": "Que se passe-t-il quand je supprime mon compte ?",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "La planification ouvre un délai de 30 jours sans rien effacer. Le nettoyage final commence ensuite et vérifie l'arrêt de l'abonnement et la suppression des données privées avant de retirer le compte. Un état en attente ne prouve pas la fin. Certains enregistrements (facturation, sécurité, légal, sauvegardes, fournisseurs) peuvent subsister selon la politique de confidentialité.",
    "Does KovaGPT support MFA?": "KovaGPT prend-il en charge la double authentification ?",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "Vous pouvez la gérer dans les Paramètres si votre méthode de connexion la prend en charge.",
    "What should I do if someone accessed my account?":
      "Que faire si quelqu'un a accédé à mon compte ?",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "Sécurisez d'abord votre e-mail ou fournisseur d'identité, changez vos identifiants, révoquez les sessions ou intégrations inconnues, activez la double authentification et contactez l'assistance.",
    "Can support see my password?": "L'assistance peut-elle voir mon mot de passe ?",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "Non. N'envoyez jamais de mot de passe, code à usage unique, clé d'accès, code de récupération ni numéro complet de carte.",
    "How do I contact KovaGPT about privacy?":
      "Comment contacter KovaGPT au sujet de la confidentialité ?",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "Utilisez le formulaire ci-dessous, choisissez Confidentialité et sécurité et envoyez-le depuis l'e-mail du compte. Vous pouvez aussi écrire à support@kovagpt.com.",
    "What are Scheduled Tasks?": "Que sont les tâches planifiées ?",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "Ce sont des enregistrements de flux récurrents ou déclenchés par un événement. L'exécution en arrière-plan n'est pas disponible ici ; les tâches existantes restent gérables.",
    "Why can I not create a Scheduled Task?": "Pourquoi ne puis-je pas créer de tâche planifiée ?",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "L'exécution planifiée est indisponible tant qu'un planificateur approuvé et actif n'est pas connecté. Les tâches enregistrées restent gérables.",
    "Can I edit, pause, or delete a saved task?":
      "Puis-je modifier, suspendre ou supprimer une tâche ?",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "Ouvrez Tâches planifiées et utilisez les commandes de chaque tâche. Les gérer n'active pas l'exécution en arrière-plan.",
    "KovaGPT is slow or not responding.": "KovaGPT est lent ou ne répond pas.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "Réessayez une fois, actualisez, vérifiez la connexion et fermez les onglets lourds. Reconnectez-vous si besoin, désactivez les extensions gênantes, puis essayez un autre navigateur ou appareil.",
    "A message is stuck on Thinking.": "Un message reste bloqué sur Réflexion.",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "Arrêtez la réponse, réessayez une fois, puis actualisez et vérifiez la connexion. Essayez une demande plus courte ou un mode plus rapide ; si cela se répète, contactez l'assistance avec l'heure et le mode.",
    "My message failed to send.": "Mon message n'a pas été envoyé.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "Réessayez une fois, vérifiez la connexion et votre quota, puis actualisez. Retirez les pièces jointes non prises en charge, reconnectez-vous et essayez un autre navigateur avant de contacter l'assistance.",
    "Search is not working.": "La recherche ne fonctionne pas.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "Réessayez, vérifiez que la recherche est sélectionnée et testez une requête publique simple. Actualisez, vérifiez connexion et quota, désactivez les bloqueurs, puis contactez l'assistance.",
    "An image will not generate.": "Une image ne se génère pas.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "Réessayez avec des réglages pris en charge et une requête conforme. Vérifiez quota et connexion, actualisez et essayez un autre navigateur avant de contacter l'assistance.",
    "Uploads keep failing.": "Les importations échouent toujours.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "Vérifiez type, taille et quota, puis réessayez un fichier à la fois. Actualisez, vérifiez la connexion, retirez les extensions qui bloquent les importations et essayez un autre navigateur.",
    "My subscription is not showing.": "Mon abonnement n'apparaît pas.",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "Actualisez Paramètres → Facturation, vérifiez que vous êtes sur le compte de l'achat, puis reconnectez-vous. N'achetez pas deux fois ; contactez l'assistance avec le reçu si besoin.",
    "The page looks broken or my sidebar disappeared.":
      "La page semble cassée ou la barre latérale a disparu.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "Actualisez et réinitialisez le zoom, élargissez la fenêtre ou utilisez la navigation mobile. Désactivez les extensions qui modifient les pages et essayez un autre navigateur.",
    "Why is a feature missing on another device?":
      "Pourquoi une fonction manque-t-elle sur un autre appareil ?",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "Vérifiez que les deux appareils utilisent le même compte, forfait, version et réglages. Certaines fonctions du navigateur et données locales dépendent de l'appareil.",
    "I see an error message. What should I send support?":
      "J'ai un message d'erreur. Que dois-je envoyer ?",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "Indiquez le message exact, la page, l'heure, ce que vous avez cliqué, le résultat attendu, le navigateur, l'appareil et tout identifiant visible. Masquez secrets et données de paiement.",
    "How do I contact support?": "Comment contacter l'assistance ?",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "Utilisez le formulaire ou écrivez à support@kovagpt.com avec l'e-mail du compte, la page, ce qui s'est passé et ce que vous attendiez.",
    "How do I report a bug?": "Comment signaler un bug ?",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "Choisissez Signaler un bug et décrivez les étapes, le résultat, le résultat attendu, le navigateur, l'appareil et toute erreur ou identifiant.",
    "Can I request a feature?": "Puis-je demander une fonctionnalité ?",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "Oui. Choisissez Demande de fonctionnalité et expliquez le problème à résoudre, sans données sensibles.",
    "What should I never send support?": "Que ne faut-il jamais envoyer ?",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "N'envoyez jamais de mots de passe, codes à usage unique, clés d'accès, codes de récupération, secrets d'API ni numéros complets de carte.",
    "What is included in Free?": "Que comprend Free ?",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "Essayez KovaGPT avec une utilisation très limitée. Argon Lite et Moyen (Réflexion). Organisez vos discussions dans des projets. Retrouvez fichiers et images dans la bibliothèque. Utilisation très limitée ; limites sur tous les modèles. Génération d'images et importations limitées. Stockage cloud inclus. Recherche et images selon la disponibilité des fournisseurs. Mémoire de base si activée.",
    "What is included in Plus?": "Que comprend Plus ?",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "Utilisation étendue avec les sept modèles jusqu'à Max : Lite, Moyen, Élevé, Très élevé et Max. Limites sur tous les modèles. Organisez vos discussions dans des projets et retrouvez fichiers et images dans la bibliothèque. Plus de génération d'images et d'importations. Stockage cloud inclus. Recherche et images selon la disponibilité des fournisseurs. Mémoire améliorée si activée.",
    "What is included in Pro?": "Que comprend Pro ?",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "Notre utilisation la plus élevée avec les sept modèles jusqu'à Ultra : Lite, Moyen, Élevé, Très élevé, Max et Ultra. Limites sur tous les modèles. Organisez vos discussions dans des projets et retrouvez fichiers et images dans la bibliothèque. Plus de génération d'images et d'importations. Stockage cloud inclus. Recherche et images selon la disponibilité des fournisseurs. Mémoire étendue si activée.",
    "Getting started": "Bien démarrer",
    "Account & sign-in": "Compte et connexion",
    "Chat & modes": "Discussion et modes",
    "Search & research": "Recherche",
    "Files & images": "Fichiers et images",
    "Library & sharing": "Bibliothèque et partage",
    "Apps & integrations": "Apps et intégrations",
    "Local places": "Lieux locaux",
    "Settings & memory": "Paramètres et mémoire",
    "Billing & plans": "Facturation et forfaits",
    "Privacy & security": "Confidentialité et sécurité",
    Troubleshooting: "Dépannage",
    "Contact & support": "Contact et assistance",
    "Help categories": "Catégories d'aide",
    Back: "Retour",
    "KovaGPT Help Center": "Centre d'aide KovaGPT",
    "How can we help?": "Comment pouvons-nous vous aider ?",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "Cherchez des réponses, parcourez les sujets courants ou contactez l'assistance KovaGPT.",
    "Search help…": "Rechercher dans l'aide…",
    "Search help": "Rechercher dans l'aide",
    "Try a different search or send us a message below.":
      "Essayez une autre recherche ou envoyez-nous un message ci-dessous.",
    "Show more answers": "Afficher plus de réponses",
    "Find a fix for your setup": "Trouvez une solution adaptée",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "Choisissez le problème, le navigateur, la connexion, le forfait et le moment où il a commencé pour obtenir des étapes précises. Ces parcours combinent articles d'aide et vérifications ; ce ne sont pas des rapports de chaque problème.",
    "Your issue": "Votre problème",
    "Help issue": "Problème",
    "Browser & device": "Navigateur et appareil",
    "Help browser": "Navigateur",
    Connection: "Connexion",
    "Help connection": "Connexion",
    "Kova plan": "Forfait Kova",
    "Help plan": "Forfait",
    "When it started": "Depuis quand",
    "Help stage": "Moment",
    "Troubleshooting steps": "Étapes de dépannage",
    "Loading support form…": "Chargement du formulaire…",
    "Request accepted": "Demande acceptée",
    "Send another message": "Envoyer un autre message",
    "Still need help?": "Besoin d'aide ?",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "Vous ne trouvez pas la réponse ? Écrivez à l'assistance KovaGPT et nous vous répondrons par e-mail.",
    Optional: "Facultatif",
    Topic: "Sujet",
    "Choose a topic": "Choisissez un sujet",
    "Tell us what happened, what you expected, and any error message you saw.":
      "Dites-nous ce qui s'est passé, ce que vous attendiez et tout message d'erreur.",
    "We’ll use your email only to respond to this support request.":
      "Nous utiliserons votre e-mail uniquement pour répondre à cette demande.",
    "Sending…": "Envoi…",
    "Support request status": "État de la demande",
    "Your message is still here.": "Votre message est toujours là.",
    Features: "Fonctionnalités",
    Learn: "Apprendre",
    Business: "Entreprises",
    Pricing: "Tarifs",
    Review: "Avis",
    "Open KovaGPT": "Ouvrir KovaGPT",
    "Open app": "Ouvrir l'app",
    "All projects": "Tous les projets",
    "My projects": "Mes projets",
    "Shared with me": "Partagés avec moi",
    "Browse answers": "Parcourir les réponses",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      "Essayez « résilier l'abonnement », « connexion impossible », « lent » ou « Google mail ».",
  },
  de: {
    "Why is Thinking blue?": "Warum ist „Denkt nach“ blau?",
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      "Gehirn und „Denkt nach“ werden blau, wenn gründliches Nachdenken aktiv ist. Klicke erneut für den Standard. Free hat einen einfachen Ein/Aus-Schalter; Plus und Pro haben zusätzliche Modellstufen.",
    "How do I resize or color the sidebar?": "Wie ändere ich Größe oder Farbe der Seitenleiste?",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "Ziehe am Desktop den rechten Rand der Seitenleiste. Du kannst den Rand auch fokussieren und Links oder Rechts drücken; Pos1 und Ende setzen Mindest- und Höchstbreite. Unter Mehr → Seitenleiste anpassen wählst du Elemente, Farbe, Suchposition und letzte Chats. Die Auswahl wird für dieses Konto in diesem Browser gespeichert.",
    "How do I copy or remove a chat link?": "Wie kopiere oder entferne ich einen Chat-Link?",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "Wähle in einem gespeicherten Chat „Teilen“, um den öffentlichen Link zu kopieren. Jeder mit dem Link kann den Schnappschuss 30 Tage lesen; Dateien und spätere Nachrichten sind ausgeschlossen. Links widerrufst du unter Einstellungen → Datenkontrollen. Die Erfolgsmeldung erscheint nur, wenn die Zwischenablage den Link annimmt.",
    "The clipboard won't copy a share link.": "Die Zwischenablage kopiert den Link nicht.",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "Wenn die Zwischenablage nicht funktioniert, erscheint der Link in einem Dialog. Markiere ihn zum manuellen Kopieren oder wähle „Link kopieren“ erneut.",
    "Which image shapes and custom sizes can I use?":
      "Welche Bildformate und Größen kann ich nutzen?",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "Wähle Quadrat 1:1, Quer 3:2, Hoch 2:3, Breitbild 16:9, Story 9:16 oder Eigene Größe mit einem unterstützten Modell. Eigene Kanten müssen Vielfache von 16 sein, höchstens 3840 Pixel, insgesamt 655.360–8.294.400 Pixel, Verhältnis 1:3 bis 3:1. Größere Bilder können länger dauern.",
    "How do I create an image in a normal chat?":
      "Wie erstelle ich ein Bild in einem normalen Chat?",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "Öffne das +-Menü, wähle „Bild erstellen“, beschreibe dein Bild und sende die Nachricht. Anmeldung und verfügbares Bildkontingent sind nötig. Das Ergebnis bleibt im Chat und kann in der Bibliothek gespeichert werden.",
    "Why doesn't the activity panel show Cloud browser?":
      "Warum zeigt das Aktivitätsfeld keinen Cloud-Browser?",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "Das Feld zeigt aufgezeichnete Quellen und Ausgaben dieses Chats. Browservorschau und Tab-Anzahl erscheinen, wenn eine Browserintegration echte Sitzungsdaten liefert. Eine Websuche allein bedeutet keinen aktiven Cloud-Browser.",
    "How much usage does each plan include?": "Wie viel Nutzung enthält jeder Tarif?",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "Free bietet sehr begrenzte Nutzung. Plus kostet 16 $ pro Monat mit erweiterter Chatnutzung. Pro kostet 80 $ pro Monat mit unserem höchsten Kontingent. Die Nutzung hängt von Modell und Aufgabe ab; für alle Modelle gelten Limits.",
    "Scheduled tasks says access could not be verified.":
      "Geplante Aufgaben meldet, dass der Zugriff nicht geprüft werden konnte.",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "Lade einmal neu und prüfe, ob dasselbe Konto angemeldet ist. Bleibt es bestehen, muss der Support Aufgabenschema und Zugriffsfunktionen prüfen. Neuladen behebt keine fehlende Datenbankmigration. Lösche keine Aufgaben als Workaround.",
    "My task is saved but background execution isn't ready.":
      "Meine Aufgabe ist gespeichert, aber die Hintergrundausführung ist nicht bereit.",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "Prüfe Status und Zeitzone der Aufgabe. Geplante Ausführung braucht einen konfigurierten Anbieter, eine freigegebene Richtlinie und einen funktionierenden Planer. Meldet die Seite ein Problem, behalte die Aufgabe und kontaktiere den Support; mehrfaches Ausführen kann Doppelarbeit erzeugen.",
    "What is KovaGPT?": "Was ist KovaGPT?",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "KovaGPT ist ein KI-Arbeitsbereich für Unterhaltungen, Webrecherche, Dateien, Bilder, Projekte und verbundene Apps. Die Verfügbarkeit hängt von deinem Tarif und den eingerichteten Anbietern ab.",
    "What should I try first?": "Was sollte ich zuerst ausprobieren?",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "Starte einen Chat und stelle eine konkrete Frage oder beschreibe dein Ziel. Für laufende Arbeit wähle Projekte in der Seitenleiste, damit Chats, Anweisungen und Dateien zusammenbleiben.",
    "How do I start a new chat?": "Wie starte ich einen neuen Chat?",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "Wähle „Neuer Chat“ in der Seitenleiste. Wähle einen Modus oder ein Tool, gib deine Nachricht ein und sende sie.",
    "Where are my previous chats?": "Wo sind meine früheren Chats?",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "Normale Chats werden bei Anmeldung mit deinem Konto synchronisiert, wenn die Synchronisierung verfügbar ist. Offline-Änderungen bleiben bis zur Bestätigung auf dem Gerät; temporäre Chats landen nicht im Verlauf.",
    "Can I use KovaGPT without an account?": "Kann ich KovaGPT ohne Konto nutzen?",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "Für Chats, Bilder, Bibliothek und Tools brauchst du ein bestätigtes Konto. Wähle „Anmelden“ oder „Konto erstellen“. Hilfe, Preise, rechtliche Infos und geteilte Nur-Lesen-Links sind öffentlich.",
    "Does KovaGPT work on mobile?": "Funktioniert KovaGPT auf dem Handy?",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "Ja. KovaGPT passt sich jedem Bildschirm an und lässt sich als Web-App installieren, wenn der Browser das unterstützt.",
    "Which browsers are supported?": "Welche Browser werden unterstützt?",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "Nutze eine aktuelle Version eines modernen Browsers. Fehlen Funktionen wie Passkeys, Installation oder Push-Benachrichtigungen, aktualisiere ihn oder probiere einen anderen.",
    "How do I create an account?": "Wie erstelle ich ein Konto?",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "Wähle „Anmelden“ und fahre mit einem verfügbaren Anbieter oder per E-Mail fort. Es werden nur aktivierte Methoden angezeigt.",
    "How do I change my display name or profile image?":
      "Wie ändere ich Anzeigename oder Profilbild?",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "Öffne Profilmenü → Einstellungen → Konto und aktualisiere die verfügbaren Felder. Vom Anbieter verwaltete Angaben änderst du dort.",
    "How do I change my password?": "Wie ändere ich mein Passwort?",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "Wähle „Passwort vergessen“ auf dem E-Mail-Anmeldebildschirm. Bei Google- oder anderen Anbieterkonten verwaltest du das Passwort dort.",
    "How does Google sign-in work?": "Wie funktioniert die Google-Anmeldung?",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "Wähle „Mit Google fortfahren“ und bestätige die Anfrage. KovaGPT erhält dein Google-Passwort nicht.",
    "Why did Google sign-in fail?": "Warum ist die Google-Anmeldung fehlgeschlagen?",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "Versuche es erneut, lade die Seite neu, erlaube das Anmeldefenster und prüfe, ob Cookies blockiert sind. Probiere dann einen anderen Browser; kontaktiere den Support, wenn es weiter auftritt.",
    "I cannot sign in. What should I try?": "Ich kann mich nicht anmelden. Was tun?",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "Versuche es einmal erneut, lade neu, prüfe die Verbindung und fordere eine neue Anmelde- oder Passwort-E-Mail an. Prüfe Datenschutz-Blocker und probiere einen anderen Browser oder ein anderes Gerät, bevor du den Support kontaktierst.",
    "Why did my sign-in email not arrive?": "Warum kam meine Anmelde-E-Mail nicht an?",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "Prüfe Spam und Werbung, bestätige die Adresse und fordere eine neue E-Mail an. Nutze nur den neuesten Link, ältere funktionieren eventuell nicht.",
    "Does KovaGPT support passkeys?": "Unterstützt KovaGPT Passkeys?",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "Passkey-Anmeldung ist verfügbar, wenn sie aktiviert ist und Browser und Gerät sie unterstützen. Verwalte Passkeys in den Einstellungen.",
    "How do I send a message?": "Wie sende ich eine Nachricht?",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "Schreibe in das Eingabefeld und wähle „Senden“ oder nutze das Tastenkürzel. Hänge bei Bedarf vorher Kontext an.",
    "How do I stop a response?": "Wie stoppe ich eine Antwort?",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "Nutze die Stopp-Schaltfläche, die während der Antwort „Senden“ ersetzt. Bereits Erhaltenes bleibt erhalten.",
    "Can I regenerate an answer?": "Kann ich eine Antwort neu erstellen?",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "Nutze „Erneut versuchen“ bei einer fertigen oder fehlgeschlagenen Antwort. Das neue Ergebnis kann abweichen, prüfe Wichtiges.",
    "Can I edit a previous message?": "Kann ich eine frühere Nachricht bearbeiten?",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "Nutze „Bearbeiten“ an deiner Nachricht. Das erzeugt ab dort einen neuen Verlauf, späterer Kontext kann sich ändern.",
    "How do I copy an answer?": "Wie kopiere ich eine Antwort?",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "Nutze „Kopieren“ an der Antwort. Für erstellte Inhalte nutze Editor oder Export.",
    "How do I rename or delete a conversation?": "Wie benenne ich einen Chat um oder lösche ihn?",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "Öffne das Chatmenü im Verlauf und wähle Umbenennen oder Löschen. Bestätige sorgfältig, Gelöschtes ist evtl. nicht wiederherstellbar.",
    "Why can KovaGPT make mistakes?": "Warum kann KovaGPT Fehler machen?",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "KI-Antworten können unvollständig oder falsch sein. Prüfe wichtige Aussagen, Berechnungen und Quellen, besonders bei medizinischen, rechtlichen, finanziellen oder sicherheitsrelevanten Entscheidungen.",
    "Does a new chat remember an earlier chat?": "Erinnert sich ein neuer Chat an einen früheren?",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "Nur das adaptive Gedächtnis überträgt ausgewählten Kontext zwischen Chats; es steht angemeldeten Plus- und Pro-Nutzern zur Verfügung, wenn aktiviert. Sonst startet jeder Chat mit eigenem Kontext.",
    "Why did a long conversation lose context?": "Warum hat ein langer Chat Kontext verloren?",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "Sehr lange Chats können den Kontext des Modells überschreiten. Nenne wichtige Details erneut, hänge eine kurze Quelle an oder starte einen neuen Chat mit Zusammenfassung.",
    "What is Lite mode?": "Was ist der Lite-Modus?",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      "Standard ist die schnellste Einstellung. In Free schaltet der Gehirn-Knopf „Denkt nach“ gründliches Denken ein oder zurück auf Standard. Plus ergänzt Mittel und Hoch; Pro ergänzt Extra hoch, Max und Ultra. Ein Konto ist nötig.",
    "What is Medium mode?": "Was ist der Mittel-Modus?",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "Mittel gibt demselben Modell mehr Arbeitszeit als Lite. Verfügbar in Plus und Pro.",
    "What is Thinking mode?": "Was ist der Denkmodus?",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "„Denkt nach“ ist in Plus der Name für den aufwändigeren Modus: dasselbe Modell mit mehr Zeit als Mittel.",
    "What is High mode?": "Was ist der Hoch-Modus?",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "Hoch ist der Pro-Name für diesen aufwändigeren Modus. Verfügbar in Pro.",
    "What is Extra High mode?": "Was ist der Extra-hoch-Modus?",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "Extra hoch gibt demselben Modell zusätzliche, begrenzte Zeit zum Analysieren, Prüfen und Überarbeiten. Verfügbar in Pro.",
    "What is Max mode?": "Was ist der Max-Modus?",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "Max nutzt für schwierige Anfragen ein größeres Arbeitsbudget mit demselben Modell. Verfügbar in Pro.",
    "What is Ultra mode?": "Was ist der Ultra-Modus?",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "Ultra ist die gründlichste Pro-Stufe und kann begrenzte Unteragenten mit demselben Modell koordinieren.",
    "Which modes are on each plan?": "Welche Modi gibt es in welchem Tarif?",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "Free enthält Lite und Mittel. Plus enthält Lite, Mittel, Hoch, Extra hoch und Max. Pro enthält Lite, Mittel, Hoch, Extra hoch, Max und Ultra. Frühere Kova-Generationen bleiben für ältere Arbeit verfügbar.",
    "Why do I not see every mode?": "Warum sehe ich nicht alle Modi?",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "Verfügbare Modi hängen von deinem Tarif und der Bereitschaft des Dienstes ab. Lade nach einem Tarifwechsel neu; zeigt die Abrechnung den neuen Tarif, aber der Modus fehlt, melde dich ab und wieder an und kontaktiere den Support.",
    "Do more capable modes take longer?": "Dauern leistungsstärkere Modi länger?",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "Ja, das kann sein. Aufwändigere Modi brauchen besonders bei komplexen Anfragen länger als Lite oder Mittel.",
    "What does Search do?": "Was macht die Suche?",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "Die Suche ruft aktuelle Webquellen ab, wenn die Anbieter verfügbar sind. Öffne die zitierten Links und prüfe, ob sie die Antwort stützen.",
    "When should I use Search?": "Wann sollte ich die Suche nutzen?",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "Nutze sie für Aktuelles, neue Produktdetails, öffentliche Live-Infos oder wenn du Quellen willst. Für Umschreiben oder Fragen zu deinem eigenen Text brauchst du sie meist nicht.",
    "Does Search browse the live web?": "Durchsucht die Suche das Live-Web?",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "Die Suche kann aktuelle Quellen abrufen, wenn ihre Anbieter verfügbar sind. Maßgeblich sind die verlinkten Seiten.",
    "Can KovaGPT cite sources?": "Kann KovaGPT Quellen angeben?",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "Die Suche kann verlinkte Quellen liefern. Öffne jede Quelle und prüfe, ob sie die Aussage stützt.",
    "Why might two searches differ?": "Warum können zwei Suchen unterschiedlich ausfallen?",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "Webseiten und Rankings ändern sich, und andere Formulierungen finden andere Belege. Vergleiche die Quellen statt nur der Zusammenfassung zu vertrauen.",
    "Why is Search unavailable?": "Warum ist die Suche nicht verfügbar?",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "Die Suche hängt von Anbietern und deinem Kontingent ab. Lade neu, prüfe, ob das Tool ausgewählt ist, und versuche es erneut; sonst kontaktiere den Support.",
    "What files can I upload to chat?": "Welche Dateien kann ich hochladen?",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "Der Chat akzeptiert Text, Code, CSV, JSON und Bilder und extrahiert lesbaren Text aus unterstützten PDF-, DOCX-, XLSX- und PPTX-Dateien. Projektwissen indexiert unterstützte Textdateien. Die Extraktion ist auf 10 MB begrenzt und kann Formatierung, Scans oder unlesbare Seiten auslassen. Die PDF-Vorschau ist vom extrahierten Text getrennt; Office-Originale können heruntergeladen, aber nicht angezeigt werden.",
    "How do I upload a file?": "Wie lade ich eine Datei hoch?",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "Nutze die Anhängen-Schaltfläche im Eingabefeld und wähle eine unterstützte Datei. Warte, bis sie vorbereitet ist, bevor du sendest.",
    "Why did my upload fail?": "Warum ist der Upload fehlgeschlagen?",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "Versuche es erneut, prüfe Typ, Größe, Verbindung und Kontingent. Lade neu und probiere eine Datei nach der anderen; klappt es nicht, kontaktiere den Support mit Dateityp und Fehlermeldung.",
    "Can KovaGPT analyze spreadsheets?": "Kann KovaGPT Tabellen analysieren?",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "KovaGPT kann Text, CSV, JSON und Bilder auswerten und Tabellen oder Diagramme zeigen. Eine allgemeine Ausführungsumgebung für Tabellen oder hochgeladenen Code gibt es nicht.",
    "Can KovaGPT understand uploaded images?": "Versteht KovaGPT hochgeladene Bilder?",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "Der Chat akzeptiert Bilder und wertet sichtbare Inhalte aus. Kleiner Text oder unklare Details können übersehen werden; prüfe mit dem Original.",
    "Are file limits different by plan?": "Hängen Dateilimits vom Tarif ab?",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "Ja. Upload- und Speicherkontingente steigen mit dem Tarif. Sieh unter Preise und in der Nutzungsanzeige nach.",
    "Can I remove a file before sending?": "Kann ich eine Datei vor dem Senden entfernen?",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "Ja. Nutze „Entfernen“ in der Anhangsvorschau vor dem Senden.",
    "How do I generate an image?": "Wie erstelle ich ein Bild?",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "Öffne Bilder, beschreibe Motiv, Aufbau und Stil, wähle Einstellungen und erstelle das Bild. Du musst angemeldet sein und Kontingent haben.",
    "How should I describe the image I want?": "Wie beschreibe ich das gewünschte Bild?",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "Nenne Motiv, Umgebung, Aufbau, Licht, Technik und Ausschlüsse. Klare Vorgaben wirken besser als viele vage Adjektive.",
    "Can I edit an existing image?": "Kann ich ein vorhandenes Bild bearbeiten?",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "Bearbeite ein Bibliotheksbild mit einem unterstützten Modell. Eine optionale transparente PNG-Maske kann die Änderung lenken. Es gilt das Bildkontingent.",
    "Why was an image request rejected?": "Warum wurde meine Bildanfrage abgelehnt?",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "Gründe können Sicherheitsregeln, ungültige Einstellungen, ein nicht unterstütztes Quellbild oder Anbieterausfälle sein. Formuliere ohne verbotene Inhalte neu und nutze unterstützte Einstellungen.",
    "Why is image generation slow?": "Warum dauert die Bilderstellung so lange?",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "Die Dauer hängt von Anbieterauslastung und Einstellungen ab. Lass die Seite offen, versuche nur nach Fehlern erneut und vermeide doppelte Anfragen.",
    "Are image limits plan dependent?": "Hängen Bildlimits vom Tarif ab?",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "Ja. Jeder Tarif hat ein tägliches Bildkontingent, bei Bezahltarifen höher.",
    "What is Canvas?": "Was ist Canvas?",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "Erstellte Texte, Code und Websites lassen sich in einem Editor mit Export und Sitzungsversionen öffnen. Versionen bleiben nach dem Schließen nicht erhalten.",
    "What are Projects?": "Was sind Projekte?",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "Projekte bündeln Chats, Dateien, Bilder, Notizen, Aufgaben, Projektgedächtnis und Anweisungen.",
    "How do I create a project?": "Wie erstelle ich ein Projekt?",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "Wähle Projekte in der Seitenleiste, dann „Neues Projekt“, gib die Details ein und erstelle es.",
    "How do I rename a project?": "Wie benenne ich ein Projekt um?",
    "Open the project and use its settings or project menu to update the name.":
      "Öffne das Projekt und ändere den Namen über Einstellungen oder Projektmenü.",
    "How do I delete a project?": "Wie lösche ich ein Projekt?",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "Öffne die Projekteinstellungen, wähle „Projekt löschen“ und bestätige. Dabei werden auch Projektdaten und -dateien gelöscht, lies die Bestätigung genau.",
    "How do I add chats to a project?": "Wie füge ich Chats zu einem Projekt hinzu?",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "Starte einen Chat im Projekt. Wo „Verschieben“ angeboten wird, kannst du auch bestehende Chats zuordnen.",
    "Can I upload files to a project?": "Kann ich Dateien in ein Projekt hochladen?",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "Ja. Projektwissen akzeptiert unterstützte Dateien im Rahmen deiner Kontingente.",
    "Does project context carry across chats?": "Gilt der Projektkontext in allen Chats?",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "Anweisungen, Wissen, Notizen und Projektgedächtnis können Chats im Projekt Kontext geben. Halte wichtige Anweisungen explizit und prüfe wichtige Ergebnisse.",
    "Can I share a project?": "Kann ich ein Projekt teilen?",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "Projektinhaber können unter Mitglieder Personen einladen, sofern der Kollaborationsdienst verfügbar ist.",
    "How do project invitations work?": "Wie funktionieren Projekteinladungen?",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "Der Inhaber lädt per E-Mail ein. Die Person meldet sich mit dieser Identität an und nimmt die Einladung an.",
    "Can someone without an account accept a project invitation?":
      "Kann jemand ohne Konto eine Einladung annehmen?",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "Die Person braucht ein KovaGPT-Konto mit der eingeladenen Identität.",
    "What happens when a collaborator is removed?": "Was passiert, wenn jemand entfernt wird?",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "Der Zugriff wird entzogen. Bereits kopierte oder exportierte Inhalte werden nicht zurückgeholt.",
    "Can I leave a shared project?": "Kann ich ein geteiltes Projekt verlassen?",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "Bitte den Inhaber, dich zu entfernen. Er behält Projekt und Inhalte.",
    "Who owns a shared project?": "Wem gehört ein geteiltes Projekt?",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "Das Konto, das es erstellt hat, bleibt Inhaber, sofern kein Wechsel bestätigt wird.",
    "What is Library?": "Was ist die Bibliothek?",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "Die Bibliothek enthält, was du speicherst oder hochlädst – keine automatische Kopie jedes Chats.",
    "How do I save something to Library?": "Wie speichere ich etwas in der Bibliothek?",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "Nutze „In Bibliothek speichern“ bei einer Antwort, einem Bild oder einer Datei. Nur Gespeichertes oder Hochgeladenes erscheint dort.",
    "Can I reopen or remove a Library item?": "Kann ich ein Element erneut öffnen oder entfernen?",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "Öffne die Bibliothek, wähle das Element zum Öffnen oder lösche es. Bestätige sorgfältig.",
    "Can I organize Library items?": "Kann ich die Bibliothek ordnen?",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "Ja. Ordner und Sammelverschieben helfen beim Ordnen.",
    "How do I share a chat?": "Wie teile ich einen Chat?",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "Nutze „Teilen“ im Chat. Prüfe Vorschau und Zugriff, bevor du einen Link erstellst oder sendest.",
    "Does a shared chat update automatically?": "Aktualisiert sich ein geteilter Chat automatisch?",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "Die Vorschau zeigt, was Empfänger sehen. Prüfe sie erneut, wenn du den Chat änderst.",
    "Which apps can I connect?": "Welche Apps kann ich verbinden?",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "Die Apps-Seite listet Google, Gmail, Google Drive, Google Kalender und GitHub. Jede Verbindung hängt von Zugangsdaten, erteilten Berechtigungen und Verfügbarkeit ab.",
    "How do I connect an app?": "Wie verbinde ich eine App?",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "Öffne Apps, wähle einen Anbieter und prüfe den Zustimmungsbildschirm. Erteile nur Berechtigungen, die du verstehst.",
    "How do I disconnect or reconnect an app?": "Wie trenne oder verbinde ich eine App erneut?",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "Öffne Apps, wähle den Dienst und „Trennen“. Zum erneuten Verbinden starte den Ablauf neu und erteile die Berechtigungen.",
    "Why does an integration ask for permission?":
      "Warum fragt eine Integration nach Berechtigungen?",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "Der Zustimmungsbildschirm zeigt nötige Berechtigungen. KovaGPT nutzt nur den erteilten Zugriff.",
    "What happens when I revoke access?": "Was passiert, wenn ich den Zugriff widerrufe?",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "Neue Aktionen funktionieren nicht mehr. Bereits übernommene Daten werden nicht automatisch gelöscht; lösche sie bei Bedarf separat.",
    "Why did a connected app stop working?": "Warum funktioniert eine verbundene App nicht mehr?",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "Versuche es erneut, prüfe Status und Berechtigungen unter Apps und verbinde ggf. neu. Ausfälle oder Konfiguration können ebenfalls Aktionen verhindern.",
    "How does Gmail integration work?": "Wie funktioniert die Gmail-Integration?",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "Verbinde Gmail unter Apps. Lese- oder Schreibaktionen hängen von Berechtigungen, Zugangsdaten und Verfügbarkeit ab.",
    "Can KovaGPT search my email or read attachments?":
      "Kann KovaGPT meine E-Mails durchsuchen oder Anhänge lesen?",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "Nur Gmail-Aktionen, die Verbindung und Berechtigungen erlauben. Prüfe Aktion und Quelle, bevor du dich darauf verlässt.",
    "Can KovaGPT draft or send email?": "Kann KovaGPT E-Mails entwerfen oder senden?",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "Schreibaktionen in Gmail erfordern eine ausdrückliche Bestätigung. KovaGPT sendet nie heimlich E-Mails.",
    "Can KovaGPT check or change my calendar?": "Kann KovaGPT meinen Kalender prüfen oder ändern?",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "Google Kalender liest oder schreibt nur mit den erteilten Berechtigungen. Termine erstellen oder ändern erfordert eine Bestätigung.",
    "Can KovaGPT search Google Drive?": "Kann KovaGPT Google Drive durchsuchen?",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "Google Drive wird unter Apps verbunden. Suchen und Lesen hängen von Berechtigungen, Dateitypen und Verfügbarkeit ab.",
    "Can KovaGPT modify Drive files?": "Kann KovaGPT Drive-Dateien ändern?",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "Geh nicht von allgemeiner Drive-Bearbeitung aus. Nur bestätigte und unterstützte Aktionen werden ausgeführt.",
    "How does GitHub integration work?": "Wie funktioniert die GitHub-Integration?",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "Verbinde GitHub unter Apps und prüfe die Berechtigungen. Repository-Aktionen hängen vom erteilten Zugriff ab.",
    "What is Local places?": "Was sind Lokale Orte?",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "Lokale Orte ist die geplante Kartenfunktion in KovaGPT. Sie bleibt bis zur Freigabe von Anbieter, Recht, Datenschutz, Kapazität und Kosten nicht verfügbar.",
    "Can it search real places?": "Kann es echte Orte suchen?",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "Nicht in der aktuellen Version. Wird Karten freigegeben, kann ein geprüfter Drittanbieter durchsucht werden; prüfe Einträge vor der Reise.",
    "Can it provide directions?": "Kann es Wegbeschreibungen geben?",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "KovaGPT kann für Wegbeschreibungen an eine externe Karte übergeben, bietet aber keine eigene Navigation.",
    "Does KovaGPT use my device location?": "Nutzt KovaGPT meinen Gerätestandort?",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "Nicht, solange Karten nicht verfügbar ist. Nach Freigabe fragt KovaGPT Koordinaten nur nach deiner ausdrücklichen Wahl ab und nennt die empfangenden Anbieter. Karten speichert keine Koordinaten in den Einstellungen.",
    "Why is Local places unavailable?": "Warum sind Lokale Orte nicht verfügbar?",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "Karten ist bewusst deaktiviert, bis Anbieter, Lizenzen, Quellenangaben, Datenschutz, Kapazität und Kosten freigegeben sind. Es fragt keinen Standort ab und ruft keine Anbieter auf.",
    "Where are Settings?": "Wo sind die Einstellungen?",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "Öffne dein Profilmenü und wähle Einstellungen: Konto, Personalisierung, Gedächtnis, Apps, Abo, Datenschutz und Darstellung, je nach Verfügbarkeit.",
    "How do I change appearance?": "Wie ändere ich die Darstellung?",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "Öffne Profilmenü → Einstellungen → Darstellung und wähle ein Design.",
    "Can I change how KovaGPT responds?": "Kann ich ändern, wie KovaGPT antwortet?",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "Nutze Personalisierung und klare Anweisungen im Chat oder Projekt. KovaGPT wendet sie auf künftige Antworten an.",
    "What is Adaptive Memory?": "Was ist das adaptive Gedächtnis?",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "Das Gedächtnis gibt es in Free, mit mehr Kapazität in Plus und Pro. Aktualisierungen aus Chats sind optional; Notizen lassen sich bearbeiten oder löschen. Temporäre Chats nutzen es nie.",
    "How do I turn Memory off or delete it?": "Wie schalte ich das Gedächtnis aus oder lösche es?",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "Öffne Einstellungen → Gedächtnis. Schalte es aus, um Nutzung und neue Einträge zu stoppen, oder wähle „Gespeichertes Gedächtnis löschen“.",
    "Is Memory the same as chat history?": "Ist das Gedächtnis dasselbe wie der Chatverlauf?",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "Nein. Der Verlauf speichert Chats; das adaptive Gedächtnis speichert ausgewählten chatübergreifenden Kontext. Ausschalten oder Löschen entfernt weder Verlauf noch Entwürfe.",
    "Does Temporary Chat use Memory?": "Nutzt ein temporärer Chat das Gedächtnis?",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "Nein. Temporäre Chats nutzen und ändern das Gedächtnis nicht und erscheinen nicht im Verlauf.",
    "How do notifications work?": "Wie funktionieren Benachrichtigungen?",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "Öffne Benachrichtigungen, um Hinweise zu sehen. Web-Push braucht einen unterstützten Browser, Erlaubnis und Konfiguration.",
    "What plans does KovaGPT offer?": "Welche Tarife bietet KovaGPT?",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "KovaGPT bietet Free, Plus und Pro. Unternehmensanforderungen besprechen wir separat; Umfang und Bedingungen werden vor dem Kauf bestätigt.",
    "How much do Plus and Pro cost?": "Was kosten Plus und Pro?",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "Die Monatspreise sind 16 USD für Plus und 80 USD für Pro zzgl. Steuern. Prüfe den Endbetrag in Stripe vor dem Kauf.",
    "How does the first-month discount work?": "Wie funktioniert der Rabatt im ersten Monat?",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "Berechtigte Konten erhalten einmalig 50 % Rabatt auf den ersten Monat von Plus oder Pro. Danach gilt der reguläre Preis. Neue Abos haben keine Testphase; bestehende Tests behalten ihre Bedingungen. Stripe bestätigt Berechtigung, erste Zahlung und Verlängerung vor dem Abschluss.",
    "How do I upgrade or downgrade?": "Wie wechsle ich den Tarif?",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "Öffne Einstellungen → Abrechnung, wähle den Wechsel und prüfe Preis und Datum vor der Bestätigung.",
    "Where do I manage my subscription?": "Wo verwalte ich mein Abo?",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "Öffne Einstellungen → Abrechnung und wähle „Abo verwalten“. Ist das Stripe-Portal nicht verfügbar, nutze den Support.",
    "What payment methods are accepted?": "Welche Zahlungsmethoden gibt es?",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "Stripe zeigt die für Konto, Gerät und Region verfügbaren Methoden. Nicht jede ist überall verfügbar.",
    "Why did my payment fail?": "Warum ist meine Zahlung fehlgeschlagen?",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "Prüfe Rechnungsdaten, Guthaben und Bankbestätigung und versuche es einmal erneut. Lehnt Stripe weiter ab, kontaktiere Bank oder Support.",
    "Where are invoices and receipts?": "Wo finde ich Rechnungen und Belege?",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "Öffne Einstellungen → Abrechnung → Abo verwalten für Belege in Stripe. Ist das Portal nicht verfügbar, schreibe dem Support von deiner Konto-E-Mail.",
    "Why was tax added?": "Warum wurden Steuern hinzugefügt?",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "Stripe berechnet Steuern anhand deiner Rechnungsdaten und geltender Regeln. Die Preise verstehen sich ohne Steuern.",
    "How do I update my payment method?": "Wie ändere ich meine Zahlungsmethode?",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "Öffne Einstellungen → Abrechnung → Abo verwalten und nutze das Stripe-Portal. Sonst kontaktiere den Support.",
    "Does my subscription renew automatically?": "Verlängert sich mein Abo automatisch?",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "Verlängerungsdatum und Bedingungen findest du im Checkout und im Stripe-Portal.",
    "How do I cancel?": "Wie kündige ich?",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "Öffne Einstellungen → Abrechnung → Abo verwalten und kündige im Stripe-Portal. Geht das nicht, schreibe dem Support von deiner Konto-E-Mail.",
    "What happens after cancellation?": "Was passiert nach der Kündigung?",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "Stripe bestätigt das Datum. Deine Chats werden nicht gelöscht, aber Bezahlfunktionen und höhere Kontingente enden mit dem Tarifwechsel.",
    "Are refunds available?": "Gibt es Rückerstattungen?",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "Prüfe die Rückerstattungsrichtlinie und kontaktiere den Support mit Konto-E-Mail und Kaufdetails. Nenne keine vollständige Kartennummer.",
    "Why is my upgraded plan not showing?": "Warum wird mein neuer Tarif nicht angezeigt?",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "Aktualisiere die Abrechnung, prüfe, ob der Kauf für dasselbe Konto erfolgte, und melde dich neu an. Kaufe nicht erneut, während die Zahlung verarbeitet wird; kontaktiere sonst den Support.",
    "How do usage limits work?": "Wie funktionieren Nutzungslimits?",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "Free ist sehr begrenzt. Plus bietet mehr, Pro unser höchstes Kontingent. Die Nutzung hängt von Modell und Aufgabe ab. Alle Modelle haben Limits; unter Nutzung siehst du die nächste Erneuerung.",
    "How does KovaGPT use my data?": "Wie nutzt KovaGPT meine Daten?",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "Die Datenschutzerklärung beschreibt Erhebung, Verarbeitung, Anbieter, Speicherdauer und deine Wahlmöglichkeiten.",
    "Are my conversations private?": "Sind meine Chats privat?",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "Chats sind je nach Modus und Synchronisierung an Konto oder Gerät gebunden. Teile keine Geheimnisse und prüfe Datenschutzerklärung und Vorschau vor dem Teilen.",
    "What happens to uploaded files?": "Was passiert mit hochgeladenen Dateien?",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "Sie werden für Chat, Projekt oder Bibliothek verarbeitet und gespeichert. Lösche sie über die jeweiligen Steuerelemente; Details zur Speicherung stehen in der Datenschutzerklärung.",
    "What data do integrations share?": "Welche Daten teilen Integrationen?",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "Der Zustimmungsbildschirm zeigt die Berechtigungen. Inhalte und Aktionsdetails können an den Anbieter gehen; widerrufe den Zugriff unter Apps oder beim Anbieter.",
    "How do I export my data?": "Wie exportiere ich meine Daten?",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "Öffne Einstellungen und nutze den Datenexport. Warte, bis er fertig ist; fehlt er oder schlägt fehl, kontaktiere den Support.",
    "How do I delete my account?": "Wie lösche ich mein Konto?",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "Öffne Einstellungen → Datenkontrollen und wähle „Löschung planen“. Konto und Daten sind 30 Tage wiederherstellbar über „Konto wiederherstellen“. Planen oder Wiederherstellen kündigt das Abo nicht und setzt den Rabatt nicht zurück; kündige ggf. separat unter Abrechnung.",
    "What happens when I delete my account?": "Was passiert, wenn ich mein Konto lösche?",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "Die Planung startet eine 30-tägige Frist, ohne etwas zu löschen. Die endgültige Bereinigung beginnt danach und prüft Abo-Beendigung und private Daten, bevor das Konto entfernt wird. „Ausstehend“ heißt nicht, dass die Löschung fertig ist. Manche Abrechnungs-, Sicherheits-, Rechts-, Backup- oder Anbieterdaten können laut Datenschutzerklärung bleiben.",
    "Does KovaGPT support MFA?": "Unterstützt KovaGPT MFA?",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "Angemeldete Nutzer verwalten MFA in den Einstellungen, wenn die Anmeldemethode es unterstützt.",
    "What should I do if someone accessed my account?":
      "Was tun, wenn jemand auf mein Konto zugegriffen hat?",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "Sichere zuerst dein E-Mail- oder Identitätskonto, ändere Zugangsdaten, widerrufe unbekannte Sitzungen oder Integrationen, aktiviere MFA und kontaktiere den Support.",
    "Can support see my password?": "Kann der Support mein Passwort sehen?",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "Nein. Sende nie Passwörter, Einmalcodes, Passkeys, Wiederherstellungscodes oder vollständige Kartennummern.",
    "How do I contact KovaGPT about privacy?": "Wie kontaktiere ich KovaGPT zum Datenschutz?",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "Nutze das Formular unten, wähle „Datenschutz & Sicherheit“ und sende es von deiner Konto-E-Mail. Oder schreibe an support@kovagpt.com.",
    "What are Scheduled Tasks?": "Was sind geplante Aufgaben?",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "Das sind Einträge für wiederkehrende oder ereignisgesteuerte Abläufe. Hintergrundausführung ist hier nicht verfügbar; gespeicherte Aufgaben lassen sich weiter verwalten.",
    "Why can I not create a Scheduled Task?": "Warum kann ich keine geplante Aufgabe erstellen?",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "Geplante Ausführung ist erst mit einem freigegebenen, aktiven Planer verfügbar. Gespeicherte Aufgaben kannst du weiter verwalten.",
    "Can I edit, pause, or delete a saved task?":
      "Kann ich eine Aufgabe bearbeiten, pausieren oder löschen?",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "Öffne Geplante Aufgaben und nutze die Steuerelemente der Aufgabe. Das aktiviert keine Hintergrundausführung.",
    "KovaGPT is slow or not responding.": "KovaGPT ist langsam oder reagiert nicht.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "Versuche es einmal erneut, lade neu, prüfe die Verbindung und schließe schwere Tabs. Melde dich ggf. neu an, deaktiviere störende Erweiterungen und probiere einen anderen Browser oder ein anderes Gerät.",
    "A message is stuck on Thinking.": "Eine Nachricht hängt bei „Denkt nach“.",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "Stoppe die Antwort, versuche es einmal erneut, lade neu und prüfe die Verbindung. Probiere eine kürzere Anfrage oder einen schnelleren Modus; wiederholt es sich, nenne dem Support Uhrzeit und Modus.",
    "My message failed to send.": "Meine Nachricht wurde nicht gesendet.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "Versuche es einmal erneut, prüfe Verbindung und Kontingent und lade neu. Entferne nicht unterstützte Anhänge, melde dich neu an und probiere einen anderen Browser, bevor du den Support kontaktierst.",
    "Search is not working.": "Die Suche funktioniert nicht.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "Versuche es erneut, prüfe, ob die Suche ausgewählt ist, und teste eine normale öffentliche Anfrage. Lade neu, prüfe Verbindung und Kontingent, deaktiviere Blocker und kontaktiere dann den Support.",
    "An image will not generate.": "Ein Bild wird nicht erstellt.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "Versuche es mit unterstützten Einstellungen und einem regelkonformen Prompt erneut. Prüfe Kontingent und Verbindung, lade neu und probiere einen anderen Browser, bevor du den Support kontaktierst.",
    "Uploads keep failing.": "Uploads schlagen immer wieder fehl.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "Prüfe Typ, Größe und Kontingent und versuche es Datei für Datei. Lade neu, prüfe die Verbindung, entferne blockierende Erweiterungen und probiere einen anderen Browser.",
    "My subscription is not showing.": "Mein Abo wird nicht angezeigt.",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "Aktualisiere Einstellungen → Abrechnung, prüfe, ob du im Kaufkonto bist, und melde dich neu an. Kaufe nicht doppelt; fehlt es weiter, kontaktiere den Support mit Beleg.",
    "The page looks broken or my sidebar disappeared.":
      "Die Seite wirkt kaputt oder die Seitenleiste ist weg.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "Lade neu und setze den Zoom zurück, vergrößere das Fenster oder nutze die mobile Navigation. Deaktiviere seitenverändernde Erweiterungen und probiere einen anderen Browser.",
    "Why is a feature missing on another device?":
      "Warum fehlt eine Funktion auf einem anderen Gerät?",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "Prüfe, ob beide Geräte dasselbe Konto, denselben Tarif, dieselbe Version und Einstellungen nutzen. Manche Browserfunktionen und lokale Daten sind gerätespezifisch.",
    "I see an error message. What should I send support?":
      "Ich sehe eine Fehlermeldung. Was schicke ich dem Support?",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "Nenne genaue Meldung, Seite, Uhrzeit, Klick, erwartetes Ergebnis, Browser, Gerät und sichtbare Korrelations-ID. Entferne Geheimnisse und Zahlungsdaten aus Screenshots.",
    "How do I contact support?": "Wie kontaktiere ich den Support?",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "Nutze das Formular oder schreibe an support@kovagpt.com mit Konto-E-Mail, Seite, Ablauf und Erwartung.",
    "How do I report a bug?": "Wie melde ich einen Fehler?",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "Wähle „Fehlerbericht“ und beschreibe Schritte, Ergebnis, Erwartung, Browser, Gerät und Fehler- oder Korrelations-ID.",
    "Can I request a feature?": "Kann ich eine Funktion vorschlagen?",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "Ja. Wähle „Funktionswunsch“ und beschreibe das Problem, ohne sensible Daten zu senden.",
    "What should I never send support?": "Was sollte ich dem Support nie schicken?",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "Sende nie Passwörter, Einmalcodes, Passkeys, Wiederherstellungscodes, API-Geheimnisse oder vollständige Kartennummern.",
    "What is included in Free?": "Was ist in Free enthalten?",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "Teste KovaGPT mit sehr begrenzter Nutzung. Argon Lite und Mittel (Denkt nach). Chats in Projekten ordnen. Dateien und Bilder in der Bibliothek finden. Sehr begrenzte Chatnutzung; Limits für alle Modelle. Begrenzte Bilderstellung und Uploads. Cloud-Speicher inklusive. Suche und Bilder, wenn die Anbieter verfügbar sind. Basis-Gedächtnis, wenn aktiviert.",
    "What is included in Plus?": "Was ist in Plus enthalten?",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "Erweiterte Nutzung mit allen sieben Modellen bis Max: Lite, Mittel, Hoch, Extra hoch und Max. Limits für alle Modelle. Chats in Projekten ordnen, Dateien und Bilder in der Bibliothek finden. Mehr Bilderstellung und Uploads. Cloud-Speicher inklusive. Suche und Bilder, wenn die Anbieter verfügbar sind. Erweitertes Gedächtnis, wenn aktiviert.",
    "What is included in Pro?": "Was ist in Pro enthalten?",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "Unsere höchste Nutzung mit allen sieben Modellen bis Ultra: Lite, Mittel, Hoch, Extra hoch, Max und Ultra. Limits für alle Modelle. Chats in Projekten ordnen, Dateien und Bilder in der Bibliothek finden. Mehr Bilderstellung und Uploads. Cloud-Speicher inklusive. Suche und Bilder, wenn die Anbieter verfügbar sind. Erweitertes Gedächtnis, wenn aktiviert.",
    "Getting started": "Erste Schritte",
    "Account & sign-in": "Konto & Anmeldung",
    "Chat & modes": "Chat & Modi",
    "Search & research": "Suche & Recherche",
    "Files & images": "Dateien & Bilder",
    "Library & sharing": "Bibliothek & Teilen",
    "Apps & integrations": "Apps & Integrationen",
    "Local places": "Lokale Orte",
    "Settings & memory": "Einstellungen & Gedächtnis",
    "Billing & plans": "Abrechnung & Tarife",
    "Privacy & security": "Datenschutz & Sicherheit",
    Troubleshooting: "Fehlerbehebung",
    "Contact & support": "Kontakt & Support",
    "Help categories": "Hilfekategorien",
    Back: "Zurück",
    "KovaGPT Help Center": "KovaGPT-Hilfe-Center",
    "How can we help?": "Wie können wir helfen?",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "Antworten suchen, häufige Themen durchsehen oder den KovaGPT-Support kontaktieren.",
    "Search help…": "Hilfe durchsuchen…",
    "Search help": "Hilfe durchsuchen",
    "Try a different search or send us a message below.":
      "Versuche eine andere Suche oder schreib uns unten.",
    "Show more answers": "Mehr Antworten anzeigen",
    "Find a fix for your setup": "Lösung für dein Setup finden",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "Wähle Problem, Browser, Verbindung, Tarif und Beginn für konkrete Schritte. Diese Wege kombinieren Hilfeartikel mit Prüfungen; sie sind keine Berichte über jedes mögliche Problem.",
    "Your issue": "Dein Problem",
    "Help issue": "Problem",
    "Browser & device": "Browser & Gerät",
    "Help browser": "Browser",
    Connection: "Verbindung",
    "Help connection": "Verbindung",
    "Kova plan": "Kova-Tarif",
    "Help plan": "Tarif",
    "When it started": "Seit wann",
    "Help stage": "Zeitpunkt",
    "Troubleshooting steps": "Schritte zur Fehlerbehebung",
    "Loading support form…": "Formular wird geladen…",
    "Request accepted": "Anfrage angenommen",
    "Send another message": "Weitere Nachricht senden",
    "Still need help?": "Brauchst du noch Hilfe?",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "Keine Antwort gefunden? Schreib dem KovaGPT-Support, wir antworten per E-Mail.",
    Optional: "Optional",
    Topic: "Thema",
    "Choose a topic": "Thema wählen",
    "Tell us what happened, what you expected, and any error message you saw.":
      "Beschreibe, was passiert ist, was du erwartet hast und welche Fehlermeldung du gesehen hast.",
    "We’ll use your email only to respond to this support request.":
      "Wir nutzen deine E-Mail nur, um auf diese Anfrage zu antworten.",
    "Sending…": "Wird gesendet…",
    "Support request status": "Status der Anfrage",
    "Your message is still here.": "Deine Nachricht ist noch da.",
    Features: "Funktionen",
    Learn: "Lernen",
    Business: "Unternehmen",
    Pricing: "Preise",
    Review: "Bewertungen",
    "Open KovaGPT": "KovaGPT öffnen",
    "Open app": "App öffnen",
    "All projects": "Alle Projekte",
    "My projects": "Meine Projekte",
    "Shared with me": "Mit mir geteilt",
    "Browse answers": "Antworten durchsuchen",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      "Probiere „Abo kündigen“, „Anmeldung geht nicht“, „langsam“ oder „Google Mail“.",
  },
  "pt-BR": {
    "Why is Thinking blue?": "Por que Pensando fica azul?",
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      "O cérebro e o rótulo Pensando ficam azuis quando o raciocínio profundo está ativado. Clique de novo para voltar ao padrão. O Free tem um botão liga/desliga; Plus e Pro têm níveis de modelo adicionais.",
    "How do I resize or color the sidebar?": "Como redimensiono ou mudo a cor da barra lateral?",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "No computador, arraste a borda direita da barra lateral. Você também pode focar a borda e usar Esquerda ou Direita; Home e End usam as larguras mínima e máxima. Abra Mais → Personalizar barra lateral para escolher itens, cor, posição da pesquisa e chats recentes. As escolhas ficam salvas nesta conta neste navegador.",
    "How do I copy or remove a chat link?": "Como copio ou removo o link de um chat?",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "Escolha Compartilhar em um chat salvo para copiar o link público. Qualquer pessoa com o link pode ler essa captura por 30 dias; arquivos e mensagens futuras ficam de fora. Revogue links em Configurações → Controles de dados. A confirmação só aparece quando a área de transferência aceita o link.",
    "The clipboard won't copy a share link.": "A área de transferência não copia o link.",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "Se a área de transferência falhar, o link aparece em uma caixa. Selecione-o para copiar manualmente ou escolha Copiar link para tentar de novo.",
    "Which image shapes and custom sizes can I use?":
      "Quais formatos e tamanhos de imagem posso usar?",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "Escolha Quadrado 1:1, Paisagem 3:2, Retrato 2:3, Widescreen 16:9, Story 9:16 ou Personalizado com um modelo compatível. Os lados personalizados devem ser múltiplos de 16, até 3840 pixels, com 655.360–8.294.400 pixels no total e proporção de 1:3 a 3:1. Imagens maiores podem demorar mais.",
    "How do I create an image in a normal chat?": "Como crio uma imagem em um chat normal?",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "Abra o menu + e escolha Criar imagem, descreva o que quer e envie. É preciso estar conectado e ter cota de imagens. O resultado fica na conversa e pode ser salvo na biblioteca.",
    "Why doesn't the activity panel show Cloud browser?":
      "Por que o painel de atividade não mostra o navegador na nuvem?",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "O painel mostra as fontes e saídas registradas desta conversa. A prévia e o número de abas aparecem quando uma integração de navegador fornece dados reais de sessão. Uma pesquisa na web sozinha não indica navegador na nuvem ativo.",
    "How much usage does each plan include?": "Quanto uso cada plano inclui?",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "O Free tem uso bem limitado. O Plus custa US$ 16 por mês com uso ampliado. O Pro custa US$ 80 por mês com nossa maior cota. O uso varia conforme o modelo e a tarefa, e há limites em todos os modelos.",
    "Scheduled tasks says access could not be verified.":
      "Tarefas agendadas diz que o acesso não pôde ser verificado.",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "Recarregue uma vez e confirme que a mesma conta está conectada. Se continuar, o Suporte precisa verificar o esquema de tarefas e as funções de acesso. Recarregar não corrige uma migração de banco ausente. Não exclua tarefas como solução.",
    "My task is saved but background execution isn't ready.":
      "Minha tarefa está salva, mas a execução em segundo plano não está pronta.",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "Verifique o status e o fuso horário da tarefa. A execução agendada exige um provedor configurado, uma política aprovada e um agendador saudável. Se a página indicar problema no serviço, mantenha a tarefa e fale com o Suporte; executar várias vezes pode duplicar o trabalho.",
    "What is KovaGPT?": "O que é o KovaGPT?",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "O KovaGPT é um espaço de trabalho com IA para conversas, pesquisa na web, arquivos, imagens, projetos e apps conectados. A disponibilidade depende do plano e dos provedores configurados.",
    "What should I try first?": "O que devo testar primeiro?",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "Inicie um chat e faça uma pergunta específica ou descreva o resultado desejado. Para trabalhos contínuos, escolha Projetos na barra lateral para manter chats, instruções e arquivos juntos.",
    "How do I start a new chat?": "Como inicio um novo chat?",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "Selecione Novo chat na barra lateral. Escolha um modo ou ferramenta, digite a mensagem e envie.",
    "Where are my previous chats?": "Onde estão meus chats anteriores?",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "Chats normais sincronizam com sua conta quando a sincronização está disponível. Edições offline ficam no dispositivo até serem confirmadas; o chat temporário não entra no histórico.",
    "Can I use KovaGPT without an account?": "Posso usar o KovaGPT sem conta?",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "É preciso uma conta verificada para conversar, criar ou editar imagens, gerenciar a biblioteca e usar as ferramentas. Escolha Entrar ou Criar conta. Ajuda, preços, informações legais e links compartilhados somente leitura são públicos.",
    "Does KovaGPT work on mobile?": "O KovaGPT funciona no celular?",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "Sim. O KovaGPT se adapta à tela e pode ser instalado como app web se o navegador permitir.",
    "Which browsers are supported?": "Quais navegadores são compatíveis?",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "Use uma versão atual de um navegador moderno. Se faltar algum recurso, como chaves de acesso, instalação ou notificações, atualize o navegador ou tente outro.",
    "How do I create an account?": "Como crio uma conta?",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "Escolha Entrar e continue com um provedor disponível ou e-mail. A tela mostra só os métodos ativados.",
    "How do I change my display name or profile image?": "Como mudo meu nome de exibição ou foto?",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "Abra o menu do perfil → Configurações → Conta e atualize os campos disponíveis. Dados gerenciados por um provedor são alterados lá.",
    "How do I change my password?": "Como mudo minha senha?",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "Escolha Esqueci a senha na tela de login por e-mail. Contas criadas com o Google ou outro provedor gerenciam a senha lá.",
    "How does Google sign-in work?": "Como funciona o login com o Google?",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "Escolha Continuar com o Google e aprove a solicitação. O KovaGPT não recebe sua senha do Google.",
    "Why did Google sign-in fail?": "Por que o login com o Google falhou?",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "Tente de novo, recarregue a página, permita a janela de login e confirme que os cookies não estão bloqueados. Depois tente outro navegador e fale com o suporte se continuar.",
    "I cannot sign in. What should I try?": "Não consigo entrar. O que faço?",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "Tente de novo, recarregue, verifique a conexão e peça um novo e-mail de login ou redefinição. Confira bloqueadores de privacidade e tente outro navegador ou dispositivo antes de falar com o suporte.",
    "Why did my sign-in email not arrive?": "Por que meu e-mail de login não chegou?",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "Confira spam e promoções, confirme o endereço e peça um novo e-mail. Use só o link mais recente: os antigos podem não funcionar.",
    "Does KovaGPT support passkeys?": "O KovaGPT aceita chaves de acesso?",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "O login com chave de acesso funciona quando ativado e compatível com seu navegador e dispositivo. Gerencie as chaves em Configurações.",
    "How do I send a message?": "Como envio uma mensagem?",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "Digite na caixa de mensagem e selecione Enviar ou use o atalho de teclado. Anexe contexto antes de enviar, se precisar.",
    "How do I stop a response?": "Como paro uma resposta?",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "Use o botão de parar que substitui Enviar durante a geração. O conteúdo já recebido é mantido.",
    "Can I regenerate an answer?": "Posso gerar a resposta de novo?",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "Use a ação de tentar de novo em uma resposta concluída ou com falha. O novo resultado pode ser diferente; confira detalhes importantes.",
    "Can I edit a previous message?": "Posso editar uma mensagem anterior?",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "Use a ação de editar na sua mensagem. Editar cria um novo caminho a partir daquele ponto, e o contexto seguinte pode mudar.",
    "How do I copy an answer?": "Como copio uma resposta?",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "Use a ação de copiar da resposta. Para itens gerados, use o editor ou as opções de exportação.",
    "How do I rename or delete a conversation?": "Como renomeio ou excluo uma conversa?",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "Abra o menu da conversa no histórico e escolha Renomear ou Excluir. Confirme com cuidado, pois pode não ser recuperável.",
    "Why can KovaGPT make mistakes?": "Por que o KovaGPT pode errar?",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "Respostas de IA podem ser incompletas ou erradas. Confira afirmações, cálculos e fontes importantes, principalmente em decisões médicas, jurídicas, financeiras ou de segurança.",
    "Does a new chat remember an earlier chat?": "Um novo chat lembra de um anterior?",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "Só a memória adaptativa leva contexto entre chats normais, disponível para usuários Plus e Pro conectados quando ativada. Caso contrário, cada chat começa com o próprio contexto.",
    "Why did a long conversation lose context?": "Por que uma conversa longa perdeu o contexto?",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "Conversas muito longas podem exceder o contexto do modelo. Repita os detalhes importantes, anexe uma fonte curta ou comece um novo chat com um resumo.",
    "What is Lite mode?": "O que é o modo Lite?",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      "O padrão é o modo mais rápido. No Free, o botão Pensando em forma de cérebro liga o raciocínio profundo ou volta ao padrão. O Plus adiciona Médio e Alto; o Pro adiciona Extra alto, Máx. e Ultra. É preciso ter conta.",
    "What is Medium mode?": "O que é o modo Médio?",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "O Médio dá ao mesmo modelo mais tempo que o Lite. Disponível no Plus e no Pro.",
    "What is Thinking mode?": "O que é o modo Pensando?",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "Pensando é o nome no Plus do modo de maior esforço. Usa o mesmo modelo com mais tempo que o Médio.",
    "What is High mode?": "O que é o modo Alto?",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "Alto é o nome no Pro desse modo de maior esforço. Disponível no Pro.",
    "What is Extra High mode?": "O que é o modo Extra alto?",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "Extra alto dá ao mesmo modelo mais tempo limitado para analisar, verificar e revisar. Disponível no Pro.",
    "What is Max mode?": "O que é o modo Máx.?",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "O Máx. usa um orçamento de trabalho maior com o mesmo modelo para pedidos difíceis. Disponível no Pro.",
    "What is Ultra mode?": "O que é o modo Ultra?",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "Ultra é o nível mais profundo do Pro e pode coordenar subagentes limitados sobre o mesmo modelo.",
    "Which modes are on each plan?": "Quais modos cada plano tem?",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "O Free inclui Lite e Médio. O Plus inclui Lite, Médio, Alto, Extra alto e Máx. O Pro inclui Lite, Médio, Alto, Extra alto, Máx. e Ultra. Gerações anteriores do Kova continuam disponíveis para trabalhos antigos.",
    "Why do I not see every mode?": "Por que não vejo todos os modos?",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "Os modos dependem do seu plano e da disponibilidade do serviço. Recarregue após mudar de plano; se a cobrança mostrar o novo plano e o modo ainda faltar, saia e entre de novo e fale com o suporte.",
    "Do more capable modes take longer?": "Modos mais avançados demoram mais?",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "Podem. Modos de maior esforço podem demorar mais que o Lite ou o Médio, principalmente em pedidos complexos.",
    "What does Search do?": "O que a Pesquisa faz?",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "A Pesquisa busca fontes atuais da web quando os provedores estão disponíveis. Abra os links citados e confira se apoiam a resposta.",
    "When should I use Search?": "Quando devo usar a Pesquisa?",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "Use para notícias, detalhes recentes de produtos, informações públicas ao vivo ou quando quiser fontes. Normalmente não é preciso para reescrever ou para perguntas sobre um texto seu.",
    "Does Search browse the live web?": "A Pesquisa navega na web ao vivo?",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "A Pesquisa pode buscar fontes atuais quando seus provedores estão disponíveis. As páginas vinculadas são a referência.",
    "Can KovaGPT cite sources?": "O KovaGPT pode citar fontes?",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "A Pesquisa pode retornar fontes com link. Abra cada citação e confirme que ela apoia a afirmação.",
    "Why might two searches differ?": "Por que duas pesquisas podem ser diferentes?",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "Páginas e rankings mudam, e outras palavras podem trazer outras evidências. Compare as citações em vez de confiar só no resumo.",
    "Why is Search unavailable?": "Por que a Pesquisa está indisponível?",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "A Pesquisa depende dos provedores e da sua cota. Recarregue, confirme que a ferramenta está selecionada e tente de novo; se continuar, fale com o suporte.",
    "What files can I upload to chat?": "Quais arquivos posso enviar no chat?",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "O chat aceita texto, código, CSV, JSON e imagens, e extrai texto legível de PDF, DOCX, XLSX e PPTX compatíveis. O conhecimento do projeto indexa arquivos de texto compatíveis. A extração é limitada a 10 MB e pode omitir formatação, conteúdo digitalizado ou páginas ilegíveis. A prévia do PDF original na biblioteca é separada do texto extraído; originais do Office podem ser baixados, mas não exibidos.",
    "How do I upload a file?": "Como envio um arquivo?",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "Use o botão de anexo na caixa de mensagem e escolha um arquivo compatível. Aguarde a preparação antes de enviar.",
    "Why did my upload fail?": "Por que o envio falhou?",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "Tente de novo, confirme tipo e tamanho, e verifique conexão e cota. Recarregue e tente um arquivo por vez; se falhar, fale com o suporte informando o tipo e o erro.",
    "Can KovaGPT analyze spreadsheets?": "O KovaGPT analisa planilhas?",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "O KovaGPT analisa texto, CSV, JSON e imagens e mostra tabelas ou gráficos. Não oferece um ambiente geral para executar planilhas ou código enviado.",
    "Can KovaGPT understand uploaded images?": "O KovaGPT entende imagens enviadas?",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "O chat aceita imagens compatíveis e analisa o conteúdo visível. Pode deixar passar texto pequeno ou detalhes ambíguos; confira com o original.",
    "Are file limits different by plan?": "Os limites de arquivos variam por plano?",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "Sim. As cotas de envio e armazenamento aumentam por plano. Veja Preços e o uso mostrado no produto.",
    "Can I remove a file before sending?": "Posso remover um arquivo antes de enviar?",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "Sim. Use o botão de remover na prévia do anexo antes de enviar.",
    "How do I generate an image?": "Como gero uma imagem?",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "Abra Imagens, descreva o tema, a composição e o estilo, escolha as configurações e gere. É preciso estar conectado e ter cota.",
    "How should I describe the image I want?": "Como descrevo a imagem que quero?",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "Informe o tema, o cenário, a composição, a luz, a técnica e o que não quer. Restrições claras funcionam melhor que muitos adjetivos vagos.",
    "Can I edit an existing image?": "Posso editar uma imagem existente?",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "Edite uma imagem da biblioteca com um modelo compatível. Uma máscara PNG transparente opcional pode guiar a mudança. A cota de imagens se aplica.",
    "Why was an image request rejected?": "Por que meu pedido de imagem foi recusado?",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "Um pedido pode ser recusado por regras de segurança, configurações inválidas, imagem de origem incompatível ou indisponibilidade do provedor. Reescreva sem conteúdo proibido e use configurações compatíveis.",
    "Why is image generation slow?": "Por que a geração de imagens é lenta?",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "O tempo varia conforme a carga do provedor e as configurações. Mantenha a página aberta, tente de novo só após um erro e evite pedidos duplicados.",
    "Are image limits plan dependent?": "Os limites de imagens dependem do plano?",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "Sim. Cada plano tem uma cota diária de imagens, maior nos planos pagos.",
    "What is Canvas?": "O que é o Canvas?",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "Textos, códigos e sites gerados podem abrir em um editor com exportação e versões da sessão. As versões não ficam salvas após fechar o editor.",
    "What are Projects?": "O que são Projetos?",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "Projetos organizam chats, arquivos, imagens, notas, tarefas, memória do projeto e instruções.",
    "How do I create a project?": "Como crio um projeto?",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "Selecione Projetos na barra lateral, escolha Novo projeto, preencha os dados e crie.",
    "How do I rename a project?": "Como renomeio um projeto?",
    "Open the project and use its settings or project menu to update the name.":
      "Abra o projeto e use as configurações ou o menu para mudar o nome.",
    "How do I delete a project?": "Como excluo um projeto?",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "Abra as configurações do projeto, escolha Excluir projeto e confirme. Registros e arquivos do projeto também são apagados; leia a confirmação com atenção.",
    "How do I add chats to a project?": "Como adiciono chats a um projeto?",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "Inicie um chat dentro do projeto. Onde houver a opção de mover, você também pode atribuir um chat existente.",
    "Can I upload files to a project?": "Posso enviar arquivos para um projeto?",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "Sim. O conhecimento do projeto aceita arquivos compatíveis, conforme suas cotas.",
    "Does project context carry across chats?": "O contexto do projeto vale para todos os chats?",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "Instruções, conhecimento, notas e memória do projeto podem dar contexto aos chats dele. Deixe instruções essenciais explícitas e confira resultados importantes.",
    "Can I share a project?": "Posso compartilhar um projeto?",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "Proprietários podem abrir Membros e convidar colaboradores, se o serviço de colaboração estiver disponível.",
    "How do project invitations work?": "Como funcionam os convites?",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "O proprietário envia um convite para um e-mail. A pessoa entra com essa identidade e aceita antes de acessar.",
    "Can someone without an account accept a project invitation?":
      "Alguém sem conta pode aceitar um convite?",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "A pessoa precisa de uma conta do KovaGPT ligada à identidade convidada.",
    "What happens when a collaborator is removed?":
      "O que acontece quando um colaborador é removido?",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "O acesso é revogado. O que já foi copiado ou exportado não é recuperado.",
    "Can I leave a shared project?": "Posso sair de um projeto compartilhado?",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "Peça ao proprietário para remover você. Ele mantém o projeto e o conteúdo.",
    "Who owns a shared project?": "Quem é o dono de um projeto compartilhado?",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "A conta que o criou continua dona, a menos que uma mudança seja confirmada.",
    "What is Library?": "O que é a Biblioteca?",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "A biblioteca guarda o que você salva ou envia; não é uma cópia automática de cada conversa.",
    "How do I save something to Library?": "Como salvo algo na biblioteca?",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "Use Salvar na biblioteca em uma resposta, imagem ou arquivo. Só aparece o que você salva ou envia.",
    "Can I reopen or remove a Library item?": "Posso reabrir ou remover um item?",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "Abra a biblioteca, selecione o item para reabri-lo ou use excluir. Confirme com cuidado.",
    "Can I organize Library items?": "Posso organizar a biblioteca?",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "Sim. Há pastas e opções para mover vários itens de uma vez.",
    "How do I share a chat?": "Como compartilho um chat?",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "Use Compartilhar na conversa. Revise a prévia e o acesso antes de criar ou enviar o link.",
    "Does a shared chat update automatically?": "Um chat compartilhado atualiza sozinho?",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "A prévia mostra o que os destinatários verão. Revise-a de novo após alterar a conversa.",
    "Which apps can I connect?": "Quais apps posso conectar?",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "A página de apps lista Google, Gmail, Google Drive, Google Agenda e GitHub. Cada conexão depende das credenciais, permissões concedidas e disponibilidade.",
    "How do I connect an app?": "Como conecto um app?",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "Abra Apps, escolha um provedor e revise a tela de consentimento. Aprove só as permissões que entender.",
    "How do I disconnect or reconnect an app?": "Como desconecto ou reconecto um app?",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "Abra Apps, selecione o serviço e escolha Desconectar. Para reconectar, inicie a conexão de novo e aprove as permissões.",
    "Why does an integration ask for permission?": "Por que uma integração pede permissão?",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "A tela do provedor lista as permissões necessárias. O KovaGPT só usa o acesso concedido.",
    "What happens when I revoke access?": "O que acontece se eu revogar o acesso?",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "Novas ações param de funcionar. Dados já trazidos não são removidos automaticamente; exclua-os à parte se precisar.",
    "Why did a connected app stop working?": "Por que um app conectado parou de funcionar?",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "Tente de novo, verifique status e permissões em Apps e reconecte se for o caso. Falhas do provedor ou a configuração também podem bloquear ações.",
    "How does Gmail integration work?": "Como funciona a integração com o Gmail?",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "Conecte o Gmail em Apps. As ações de leitura ou escrita dependem das permissões, credenciais e disponibilidade.",
    "Can KovaGPT search my email or read attachments?":
      "O KovaGPT pode pesquisar meu e-mail ou ler anexos?",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "Só realiza ações do Gmail permitidas pela conexão e permissões. Revise a ação e a fonte antes de confiar.",
    "Can KovaGPT draft or send email?": "O KovaGPT pode escrever ou enviar e-mail?",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "Ações de escrita no Gmail exigem confirmação explícita. O KovaGPT nunca envia e-mails sem avisar.",
    "Can KovaGPT check or change my calendar?": "O KovaGPT pode ver ou alterar minha agenda?",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "O Google Agenda lê ou escreve só com as permissões concedidas. Criar ou alterar eventos exige confirmação.",
    "Can KovaGPT search Google Drive?": "O KovaGPT pode pesquisar no Google Drive?",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "O Google Drive é conectado em Apps. Pesquisa e leitura dependem das permissões, dos tipos de arquivo e da disponibilidade.",
    "Can KovaGPT modify Drive files?": "O KovaGPT pode alterar arquivos do Drive?",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "Não suponha edição geral do Drive. Só rodam ações mostradas para confirmação e permitidas pela conexão.",
    "How does GitHub integration work?": "Como funciona a integração com o GitHub?",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "Conecte o GitHub em Apps e revise as permissões. As ações nos repositórios dependem do acesso concedido.",
    "What is Local places?": "O que é Lugares locais?",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "Lugares locais é a experiência de Mapas planejada no KovaGPT. Fica indisponível até a aprovação de provedor, jurídico, privacidade, capacidade e custos.",
    "Can it search real places?": "Pode pesquisar lugares reais?",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "Não na versão atual. Se Mapas for aprovado, poderá pesquisar em um provedor externo revisado; confira sempre os dados antes de ir.",
    "Can it provide directions?": "Pode dar rotas?",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "O KovaGPT pode abrir um mapa externo para a rota. Não tem navegação passo a passo própria.",
    "Does KovaGPT use my device location?": "O KovaGPT usa a localização do meu dispositivo?",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "Não enquanto Mapas estiver indisponível. Se aprovado, o KovaGPT só pedirá coordenadas após sua escolha explícita e informará quais provedores as recebem. Mapas não salva coordenadas nas configurações.",
    "Why is Local places unavailable?": "Por que Lugares locais está indisponível?",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "Mapas está desativado de propósito até aprovar provedor, licenças, atribuição, privacidade, capacidade e custos. Nesse estado não pede localização nem chama provedores.",
    "Where are Settings?": "Onde ficam as configurações?",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "Abra o menu do perfil e escolha Configurações: conta, personalização, memória, apps, assinatura, privacidade e aparência, conforme o caso.",
    "How do I change appearance?": "Como mudo a aparência?",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "Abra o menu do perfil → Configurações → Aparência e escolha um tema.",
    "Can I change how KovaGPT responds?": "Posso mudar como o KovaGPT responde?",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "Use a personalização e instruções explícitas no chat ou em um projeto. O KovaGPT aplica essas preferências às próximas respostas.",
    "What is Adaptive Memory?": "O que é a memória adaptativa?",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "A memória está no Free, com mais capacidade no Plus e no Pro. Atualizações das conversas são opcionais; notas podem ser editadas ou excluídas. Chats temporários nunca a usam.",
    "How do I turn Memory off or delete it?": "Como desativo ou apago a memória?",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "Abra Configurações → Memória. Desative para bloquear o uso e novas gravações, ou escolha Excluir memória salva.",
    "Is Memory the same as chat history?": "A memória é o mesmo que o histórico?",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "Não. O histórico guarda conversas; a memória adaptativa guarda contexto selecionado entre chats. Desativar ou apagar a memória não apaga o histórico nem rascunhos.",
    "Does Temporary Chat use Memory?": "O chat temporário usa a memória?",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "Não. O chat temporário não usa nem atualiza a memória e fica fora do histórico.",
    "How do notifications work?": "Como funcionam as notificações?",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "Abra Notificações para ver os avisos. Notificações push exigem navegador compatível, permissão e configuração.",
    "What plans does KovaGPT offer?": "Quais planos o KovaGPT oferece?",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "O KovaGPT oferece Free, Plus e Pro. Necessidades empresariais são tratadas à parte; escopo e termos são confirmados antes da compra.",
    "How much do Plus and Pro cost?": "Quanto custam o Plus e o Pro?",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "Os preços mensais são US$ 16 para o Plus e US$ 80 para o Pro, sem impostos. Confirme o valor final no Stripe antes de comprar.",
    "How does the first-month discount work?": "Como funciona o desconto do primeiro mês?",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "Contas elegíveis têm 50% de desconto no primeiro mês do Plus ou Pro mensal, uma vez por conta. Depois vale o preço normal. Novas assinaturas não têm teste grátis; testes existentes mantêm os termos. O Stripe confirma elegibilidade, primeiro pagamento e renovação antes da assinatura.",
    "How do I upgrade or downgrade?": "Como faço upgrade ou downgrade?",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "Abra Configurações → Cobrança, escolha a mudança e revise preço e data antes de confirmar.",
    "Where do I manage my subscription?": "Onde gerencio minha assinatura?",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "Abra Configurações → Cobrança e escolha Gerenciar assinatura. Se o portal do Stripe não estiver disponível, use o suporte.",
    "What payment methods are accepted?": "Quais formas de pagamento são aceitas?",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "O Stripe mostra as formas disponíveis para sua conta, dispositivo e região. Nem todas existem em todo lugar.",
    "Why did my payment fail?": "Por que meu pagamento falhou?",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "Confira os dados, o saldo e qualquer autenticação do banco e tente de novo uma vez. Se o Stripe continuar recusando, fale com o banco ou o suporte.",
    "Where are invoices and receipts?": "Onde ficam faturas e recibos?",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "Abra Configurações → Cobrança → Gerenciar assinatura para vê-las no Stripe. Se o portal não estiver disponível, escreva ao suporte pelo e-mail da conta.",
    "Why was tax added?": "Por que foram adicionados impostos?",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "O Stripe calcula impostos com base nos seus dados e nas regras aplicáveis. Os preços publicados não incluem impostos.",
    "How do I update my payment method?": "Como atualizo minha forma de pagamento?",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "Abra Configurações → Cobrança → Gerenciar assinatura e use o portal do Stripe. Se não estiver disponível, fale com o suporte.",
    "Does my subscription renew automatically?": "Minha assinatura renova sozinha?",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "Veja a data e as condições de renovação no checkout e no portal do Stripe.",
    "How do I cancel?": "Como cancelo?",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "Abra Configurações → Cobrança → Gerenciar assinatura e cancele no Stripe. Se não der, escreva ao suporte pelo e-mail da conta.",
    "What happens after cancellation?": "O que acontece após cancelar?",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "O Stripe confirma a data. Seus chats não são apagados, mas recursos pagos e cotas maiores terminam quando o plano muda.",
    "Are refunds available?": "Há reembolsos?",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "Veja a política de reembolso e fale com o suporte com o e-mail da conta e os dados da compra. Não informe o número completo do cartão.",
    "Why is my upgraded plan not showing?": "Por que meu novo plano não aparece?",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "Atualize a Cobrança, confirme que a compra foi na mesma conta e saia e entre de novo. Não compre de novo enquanto o pagamento é processado; fale com o suporte se continuar.",
    "How do usage limits work?": "Como funcionam os limites de uso?",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "O uso do Free é bem limitado. O Plus amplia o uso e o Pro tem nossa maior cota. Varia conforme modelo e tarefa. Todos os modelos têm limites; veja Uso para a próxima renovação.",
    "How does KovaGPT use my data?": "Como o KovaGPT usa meus dados?",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "Veja a política de privacidade sobre coleta, tratamento, provedores, retenção e suas escolhas.",
    "Are my conversations private?": "Minhas conversas são privadas?",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "Os chats ficam ligados à sua conta ou dispositivo conforme o modo e a sincronização. Não coloque segredos e revise a política e a prévia antes de compartilhar.",
    "What happens to uploaded files?": "O que acontece com os arquivos enviados?",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "São processados e armazenados conforme o recurso usado. Exclua-os pelos controles do produto e veja a política de privacidade sobre retenção.",
    "What data do integrations share?": "Que dados as integrações compartilham?",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "A tela do provedor lista as permissões. Conteúdo e detalhes da ação podem ser enviados ao provedor; revogue o acesso em Apps ou no provedor.",
    "How do I export my data?": "Como exporto meus dados?",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "Abra Configurações e use a exportação de dados. Aguarde concluir; fale com o suporte se não estiver disponível ou falhar.",
    "How do I delete my account?": "Como excluo minha conta?",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "Abra Configurações → Controles de dados e escolha Agendar exclusão. A conta pode ser recuperada por 30 dias com Recuperar conta. Agendar ou recuperar não cancela a cobrança nem reinicia o desconto; cancele à parte em Cobrança se precisar.",
    "What happens when I delete my account?": "O que acontece quando excluo a conta?",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "Agendar abre um prazo de 30 dias sem apagar nada. A limpeza final começa depois e verifica o fim da assinatura e dos dados privados antes de remover a conta. Status pendente não prova que terminou. Alguns registros de cobrança, segurança, jurídicos, backups ou provedores podem permanecer conforme a política de privacidade.",
    "Does KovaGPT support MFA?": "O KovaGPT tem verificação em duas etapas?",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "Você pode gerenciá-la em Configurações se seu método de login permitir.",
    "What should I do if someone accessed my account?": "O que faço se alguém acessou minha conta?",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "Proteja primeiro seu e-mail ou provedor de identidade, troque as credenciais, revogue sessões ou integrações desconhecidas, ative a verificação em duas etapas e fale com o suporte.",
    "Can support see my password?": "O suporte pode ver minha senha?",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "Não. Nunca envie senha, código único, chave de acesso, código de recuperação ou número completo do cartão.",
    "How do I contact KovaGPT about privacy?": "Como falo com o KovaGPT sobre privacidade?",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "Use o formulário abaixo, escolha Privacidade e segurança e envie pelo e-mail da conta. Você também pode escrever para support@kovagpt.com.",
    "What are Scheduled Tasks?": "O que são tarefas agendadas?",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "São registros de fluxos recorrentes ou por eventos. A execução em segundo plano não está disponível aqui; tarefas salvas ainda podem ser gerenciadas.",
    "Why can I not create a Scheduled Task?": "Por que não consigo criar uma tarefa agendada?",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "A execução agendada fica indisponível até conectar um agendador aprovado e ativo. Tarefas salvas ainda podem ser gerenciadas.",
    "Can I edit, pause, or delete a saved task?": "Posso editar, pausar ou excluir uma tarefa?",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "Abra Tarefas agendadas e use os controles de cada tarefa. Gerenciá-las não ativa a execução em segundo plano.",
    "KovaGPT is slow or not responding.": "O KovaGPT está lento ou não responde.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "Tente de novo, recarregue, verifique a conexão e feche abas pesadas. Saia e entre se for o caso, desative extensões que atrapalham e tente outro navegador ou dispositivo.",
    "A message is stuck on Thinking.": "Uma mensagem travou em Pensando.",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "Pare a resposta, tente de novo, recarregue e verifique a conexão. Tente um pedido mais curto ou um modo mais rápido; se repetir, fale com o suporte informando horário e modo.",
    "My message failed to send.": "Minha mensagem não foi enviada.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "Tente de novo, verifique conexão e cota e recarregue. Remova anexos incompatíveis, saia e entre e tente outro navegador antes de falar com o suporte.",
    "Search is not working.": "A pesquisa não funciona.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "Tente de novo, confirme que a Pesquisa está selecionada e faça uma consulta pública simples. Recarregue, verifique conexão e cota, desative bloqueadores e fale com o suporte.",
    "An image will not generate.": "Uma imagem não é gerada.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "Tente de novo com configurações compatíveis e um prompt dentro das regras. Verifique cota e conexão, recarregue e tente outro navegador antes de falar com o suporte.",
    "Uploads keep failing.": "Os envios continuam falhando.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "Confirme tipo, tamanho e cota e tente um arquivo por vez. Recarregue, verifique a conexão, remova extensões que bloqueiam envios e tente outro navegador.",
    "My subscription is not showing.": "Minha assinatura não aparece.",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "Atualize Configurações → Cobrança, confirme que está na conta da compra e saia e entre. Não compre duas vezes; se continuar faltando, fale com o suporte com o recibo.",
    "The page looks broken or my sidebar disappeared.":
      "A página parece quebrada ou a barra lateral sumiu.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "Recarregue e redefina o zoom, aumente a janela ou use a navegação móvel. Desative extensões que alteram páginas e tente outro navegador.",
    "Why is a feature missing on another device?": "Por que um recurso falta em outro dispositivo?",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "Confirme que os dois usam a mesma conta, plano, versão e configurações. Alguns recursos do navegador e dados locais dependem do dispositivo.",
    "I see an error message. What should I send support?":
      "Vejo uma mensagem de erro. O que envio ao suporte?",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "Inclua a mensagem exata, a página, o horário, o que clicou, o resultado esperado, navegador, dispositivo e qualquer ID visível. Tire segredos e dados de pagamento das capturas.",
    "How do I contact support?": "Como falo com o suporte?",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "Use o formulário ou escreva para support@kovagpt.com com o e-mail da conta, a página, o que aconteceu e o que esperava.",
    "How do I report a bug?": "Como relato um erro?",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "Escolha Relatório de erro e descreva os passos, o resultado, o esperado, navegador, dispositivo e qualquer erro ou ID.",
    "Can I request a feature?": "Posso pedir um recurso?",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "Sim. Escolha Pedido de recurso e explique o problema que quer resolver, sem enviar dados sensíveis.",
    "What should I never send support?": "O que nunca devo enviar ao suporte?",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "Nunca envie senhas, códigos únicos, chaves de acesso, códigos de recuperação, segredos de API ou números completos de cartão.",
    "What is included in Free?": "O que o Free inclui?",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "Experimente o KovaGPT com uso bem limitado. Argon Lite e Médio (Pensando). Organize chats em Projetos. Encontre arquivos e imagens na biblioteca. Uso de chat bem limitado; há limites em todos os modelos. Geração de imagens e envios limitados. Armazenamento na nuvem incluído. Pesquisa e imagens quando os provedores estiverem disponíveis. Memória básica quando ativada.",
    "What is included in Plus?": "O que o Plus inclui?",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "Uso ampliado com os sete modelos até o Máx.: Lite, Médio, Alto, Extra alto e Máx. Há limites em todos os modelos. Organize chats em Projetos e encontre arquivos e imagens na biblioteca. Mais geração de imagens e envios. Armazenamento na nuvem incluído. Pesquisa e imagens quando os provedores estiverem disponíveis. Memória aprimorada quando ativada.",
    "What is included in Pro?": "O que o Pro inclui?",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "Nosso maior uso com os sete modelos até o Ultra: Lite, Médio, Alto, Extra alto, Máx. e Ultra. Há limites em todos os modelos. Organize chats em Projetos e encontre arquivos e imagens na biblioteca. Mais geração de imagens e envios. Armazenamento na nuvem incluído. Pesquisa e imagens quando os provedores estiverem disponíveis. Memória estendida quando ativada.",
    "Getting started": "Primeiros passos",
    "Account & sign-in": "Conta e login",
    "Chat & modes": "Chat e modos",
    "Search & research": "Pesquisa",
    "Files & images": "Arquivos e imagens",
    "Library & sharing": "Biblioteca e compartilhamento",
    "Apps & integrations": "Apps e integrações",
    "Local places": "Lugares locais",
    "Settings & memory": "Configurações e memória",
    "Billing & plans": "Cobrança e planos",
    "Privacy & security": "Privacidade e segurança",
    Troubleshooting: "Solução de problemas",
    "Contact & support": "Contato e suporte",
    "Help categories": "Categorias de ajuda",
    Back: "Voltar",
    "KovaGPT Help Center": "Central de ajuda do KovaGPT",
    "How can we help?": "Como podemos ajudar?",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "Pesquise respostas, veja temas comuns ou fale com o suporte do KovaGPT.",
    "Search help…": "Pesquisar na ajuda…",
    "Search help": "Pesquisar na ajuda",
    "Try a different search or send us a message below.":
      "Tente outra pesquisa ou envie uma mensagem abaixo.",
    "Show more answers": "Mostrar mais respostas",
    "Find a fix for your setup": "Encontre uma solução para seu caso",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "Escolha o problema, o navegador, a conexão, o plano e quando começou para ver passos específicos. Combinam artigos de ajuda com verificações; não são relatórios de cada problema possível.",
    "Your issue": "Seu problema",
    "Help issue": "Problema",
    "Browser & device": "Navegador e dispositivo",
    "Help browser": "Navegador",
    Connection: "Conexão",
    "Help connection": "Conexão",
    "Kova plan": "Plano do Kova",
    "Help plan": "Plano",
    "When it started": "Quando começou",
    "Help stage": "Momento",
    "Troubleshooting steps": "Passos para resolver",
    "Loading support form…": "Carregando formulário…",
    "Request accepted": "Solicitação recebida",
    "Send another message": "Enviar outra mensagem",
    "Still need help?": "Ainda precisa de ajuda?",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "Não encontrou a resposta? Escreva ao suporte do KovaGPT e responderemos por e-mail.",
    Optional: "Opcional",
    Topic: "Assunto",
    "Choose a topic": "Escolha um assunto",
    "Tell us what happened, what you expected, and any error message you saw.":
      "Conte o que aconteceu, o que esperava e qualquer mensagem de erro.",
    "We’ll use your email only to respond to this support request.":
      "Usaremos seu e-mail só para responder a esta solicitação.",
    "Sending…": "Enviando…",
    "Support request status": "Status da solicitação",
    "Your message is still here.": "Sua mensagem continua aqui.",
    Features: "Recursos",
    Learn: "Aprender",
    Business: "Empresas",
    Pricing: "Preços",
    Review: "Avaliações",
    "Open KovaGPT": "Abrir KovaGPT",
    "Open app": "Abrir app",
    "All projects": "Todos os projetos",
    "My projects": "Meus projetos",
    "Shared with me": "Compartilhados comigo",
    "Browse answers": "Ver respostas",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      'Tente "cancelar assinatura", "não consigo entrar", "lento" ou "Google mail".',
  },
  ja: {
    "Why is Thinking blue?": "「考え中」が青いのはなぜですか？",
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      "より深い推論がオンのとき、脳アイコンと「考え中」が青くなります。もう一度押すと既定に戻ります。Freeはオン/オフのみ、PlusとProでは追加のモデルレベルを選べます。",
    "How do I resize or color the sidebar?": "サイドバーの幅や色を変えるには？",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "デスクトップではサイドバーの右端をドラッグします。右端にフォーカスして左右キーでも調整でき、Home/Endで最小/最大幅になります。「その他」→「サイドバーをカスタマイズ」で項目、色、検索の位置、最近のチャットの表示を選べます。設定はこのブラウザのこのアカウントに保存されます。",
    "How do I copy or remove a chat link?": "チャットのリンクをコピー・削除するには？",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "保存済みチャットで「共有」を選ぶと公開リンクをコピーできます。リンクを知っている人は30日間そのスナップショットを閲覧でき、ファイルや今後のメッセージは含まれません。リンクの取り消しは「設定」→「データ管理」から。成功の表示はクリップボードがリンクを受け取ったときだけ出ます。",
    "The clipboard won't copy a share link.": "共有リンクがクリップボードにコピーされません。",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "クリップボードが使えない場合、リンクはダイアログに表示されます。選択して手動でコピーするか、「リンクをコピー」で再試行してください。",
    "Which image shapes and custom sizes can I use?": "使える画像の形とカスタムサイズは？",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "対応モデルでは、正方形1:1、横長3:2、縦長2:3、ワイド16:9、ストーリー9:16、カスタムを選べます。カスタムの辺は16の倍数・最大3840ピクセル、総画素数655,360〜8,294,400、比率1:3〜3:1です。大きな画像は時間がかかることがあります。",
    "How do I create an image in a normal chat?": "通常のチャットで画像を作るには？",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "「+」メニューから「画像を作成」を選び、作りたいものを説明して送信します。サインインと画像の利用枠が必要です。結果はその会話に残り、ライブラリに保存できます。",
    "Why doesn't the activity panel show Cloud browser?":
      "アクティビティパネルにクラウドブラウザが表示されないのはなぜ？",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "パネルにはこの会話で記録されたソースと出力が表示されます。ブラウザ連携が実際のセッションデータを提供すると、プレビューとタブ数が表示されます。ウェブ検索だけではクラウドブラウザは起動しません。",
    "How much usage does each plan include?": "各プランの利用量は？",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "Freeは利用量がかなり限られています。Plusは月16ドルで利用枠が拡大、Proは月80ドルで最大の利用枠です。利用量はモデルやタスクによって変わり、すべてのモデルに上限があります。",
    "Scheduled tasks says access could not be verified.":
      "スケジュールタスクで「アクセスを確認できません」と表示されます。",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "一度再読み込みし、同じ確認済みアカウントでサインインしているか確認してください。続く場合はサポートがタスクのスキーマとアクセス機能を確認する必要があります。再読み込みではデータベースの移行不足は直りません。回避策としてタスクを削除しないでください。",
    "My task is saved but background execution isn't ready.":
      "タスクは保存されたがバックグラウンド実行の準備ができていません。",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "タスクの状態とタイムゾーンを確認してください。スケジュール実行には、設定済みのプロバイダー、承認済みのポリシー、正常なスケジューラが必要です。サービスの問題と表示された場合はタスクを残したままサポートに連絡してください。何度も実行すると重複作業が発生することがあります。",
    "What is KovaGPT?": "KovaGPTとは？",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "KovaGPTは、会話、ウェブ調査、対応ファイル、画像、プロジェクト、接続アプリのためのAIワークスペースです。利用できる機能はプランや設定済みのプロバイダーによって異なります。",
    "What should I try first?": "まず何を試せばいい？",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "新しいチャットを始めて、具体的な質問をするか、望む結果を説明しましょう。継続的な作業にはサイドバーの「プロジェクト」を使い、関連するチャット、指示、ファイルをまとめます。",
    "How do I start a new chat?": "新しいチャットを始めるには？",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "サイドバーの「新しいチャット」を選び、モードやツールを選んでメッセージを入力し、送信します。",
    "Where are my previous chats?": "以前のチャットはどこ？",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "サインイン中の通常チャットは、同期が利用可能なときにアカウントと同期されます。オフラインでの編集は確認されるまでこのデバイスに残り、一時チャットは履歴に残りません。",
    "Can I use KovaGPT without an account?": "アカウントなしで使えますか？",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "チャット、画像の作成・編集、ライブラリの管理、ツールの利用には確認済みのアカウントが必要です。「ログイン」または「アカウント作成」を選んでください。ヘルプ、料金、法的情報、閲覧専用の共有リンクは公開されています。",
    "Does KovaGPT work on mobile?": "スマートフォンで使えますか？",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "はい。KovaGPTは画面に合わせて表示され、対応ブラウザではウェブアプリとしてインストールできます。",
    "Which browsers are supported?": "対応ブラウザは？",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "最新のモダンブラウザをお使いください。パスキー、インストール、プッシュ通知などが使えない場合は、ブラウザを更新するか別のブラウザをお試しください。",
    "How do I create an account?": "アカウントの作り方は？",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "「サインイン」を選び、利用可能なプロバイダーまたはメールで続行します。表示されるのは有効な方法だけです。",
    "How do I change my display name or profile image?": "表示名やプロフィール画像を変えるには？",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "プロフィールメニュー →「設定」→「アカウント」で変更できる項目を更新します。プロバイダー管理の情報はそのプロバイダーで変更してください。",
    "How do I change my password?": "パスワードを変えるには？",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "メールのサインイン画面で「パスワードを忘れた」を選びます。Googleなど外部プロバイダーで作成したアカウントは、そのプロバイダーでパスワードを管理します。",
    "How does Google sign-in work?": "Googleでのサインインの仕組みは？",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "「Googleで続行」を選び、Googleのサインイン要求を承認します。KovaGPTがGoogleのパスワードを受け取ることはありません。",
    "Why did Google sign-in fail?": "Googleでのサインインに失敗したのはなぜ？",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "再試行し、ページを再読み込みし、サインインウィンドウを許可し、Cookieがブロックされていないか確認してください。その後別のブラウザを試し、解決しなければサポートに連絡してください。",
    "I cannot sign in. What should I try?": "サインインできません。どうすればいい？",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "一度再試行し、再読み込みして接続を確認し、新しいサインインまたはパスワード再設定メールを依頼してください。ブラウザのプライバシーブロッカーを確認し、別のブラウザやデバイスを試してからサポートに連絡してください。",
    "Why did my sign-in email not arrive?": "サインインメールが届かないのはなぜ？",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "迷惑メールやプロモーションを確認し、アドレスを確かめて新しいメールを依頼してください。古いリンクは使えないことがあるので、最新のリンクだけを使ってください。",
    "Does KovaGPT support passkeys?": "パスキーに対応していますか？",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "パスキーでのサインインは、有効化されていてブラウザとデバイスが対応している場合に使えます。登録済みのパスキーは設定で管理します。",
    "How do I send a message?": "メッセージを送るには？",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "入力欄に書いて「送信」を選ぶか、キーボードショートカットを使います。必要なら送信前にコンテキストを添付してください。",
    "How do I stop a response?": "応答を止めるには？",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "応答の生成中は「送信」が停止ボタンに変わります。停止しても受信済みの内容は残ります。",
    "Can I regenerate an answer?": "回答を再生成できますか？",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "完了または失敗した応答に表示される再試行を使います。結果が変わることがあるので重要な点は確認してください。",
    "Can I edit a previous message?": "前のメッセージを編集できますか？",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "メッセージに表示される編集を使います。編集するとその時点から新しい流れになり、後の文脈が変わることがあります。",
    "How do I copy an answer?": "回答をコピーするには？",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "応答のコピー操作を使います。生成物はエディタやエクスポート機能を使ってください。",
    "How do I rename or delete a conversation?": "会話の名前変更や削除は？",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "履歴の会話メニューから「名前を変更」または「削除」を選びます。削除は元に戻せないことがあるので慎重に確認してください。",
    "Why can KovaGPT make mistakes?": "KovaGPTが間違えるのはなぜ？",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "AIの回答は不完全または誤っていることがあります。特に医療、法律、金融、安全に関わる判断では、重要な主張、計算、出典を確認してください。",
    "Does a new chat remember an earlier chat?": "新しいチャットは以前のチャットを覚えていますか？",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "通常チャット間で文脈を引き継げるのはアダプティブメモリだけで、有効化時にサインイン中のPlus・Proユーザーが使えます。それ以外は新しいチャットごとに独立した文脈で始まります。",
    "Why did a long conversation lose context?": "長い会話で文脈が失われたのはなぜ？",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "非常に長い会話はモデルの文脈の上限を超えることがあります。重要な点を改めて伝えるか、簡潔な資料を添付するか、要約付きで新しいチャットを始めてください。",
    "What is Lite mode?": "Liteモードとは？",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      "既定は最速の設定です。Freeでは脳の形の「考え中」ボタンで深い推論のオン/オフを切り替えます。PlusではMediumとHigh、ProではExtra High、Max、Ultraが追加されます。アカウントが必要です。",
    "What is Medium mode?": "Mediumモードとは？",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "MediumはLiteより同じモデルに長い作業時間を与えます。PlusとProで利用できます。",
    "What is Thinking mode?": "Thinkingモードとは？",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "ThinkingはPlusでの高負荷モードの名称で、同じモデルにMediumより長い作業時間を与えます。",
    "What is High mode?": "Highモードとは？",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "HighはProでの高負荷モードの名称です。Proで利用できます。",
    "What is Extra High mode?": "Extra Highモードとは？",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "Extra Highは同じモデルに分析・確認・修正のための追加時間（上限あり）を与えます。Proで利用できます。",
    "What is Max mode?": "Maxモードとは？",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "Maxは難しい依頼に対し、同じモデルでより大きな作業量（上限あり）を使います。Proで利用できます。",
    "What is Ultra mode?": "Ultraモードとは？",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "UltraはProで最も深いモードで、同じモデル上で上限付きのサブエージェントを組み合わせて使えます。",
    "Which modes are on each plan?": "各プランで使えるモードは？",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "FreeはLiteとMedium、PlusはLite、Medium、High、Extra High、Max、ProはそれらにUltraを加えたものです。以前のKova世代も過去の作業との一貫性のため引き続き使えます。",
    "Why do I not see every mode?": "すべてのモードが表示されないのはなぜ？",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "使えるモードは現在のプランと提供状況によります。プラン変更後は再読み込みしてください。請求に新しいプランが表示されてもモードがない場合は、サインアウトして再度サインインし、サポートに連絡してください。",
    "Do more capable modes take longer?": "高性能なモードは時間がかかりますか？",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "はい。特に複雑な依頼では、高負荷モードはLiteやMediumより時間がかかることがあります。",
    "What does Search do?": "検索で何ができる？",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "検索は、設定済みのプロバイダーが利用可能なときに最新のウェブソースを取得します。引用リンクを開き、各ソースが回答を裏付けているか確認してください。",
    "When should I use Search?": "検索はいつ使う？",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "最新ニュース、最近の製品情報、公開情報、ウェブソースが欲しいときに使います。書き直しや自分で渡した文章だけに基づく質問では通常不要です。",
    "Does Search browse the live web?": "検索はリアルタイムのウェブを見ますか？",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "設定済みのプロバイダーが利用可能なら最新のソースを取得できます。正しい情報はリンク先のページです。",
    "Can KovaGPT cite sources?": "出典を示せますか？",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "検索はリンク付きのソースを返せます。各引用を開き、近くの主張を裏付けているか確認してください。",
    "Why might two searches differ?": "2回の検索結果が違うのはなぜ？",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "ウェブページや順位は変わり、言い回しが違えば別の根拠が見つかります。生成された要約だけに頼らず引用を比較してください。",
    "Why is Search unavailable?": "検索が使えないのはなぜ？",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "検索は設定済みのプロバイダーと残りの利用枠に依存します。再読み込みし、ツールが選択されているか確認して再試行してください。解決しなければサポートに連絡してください。",
    "What files can I upload to chat?": "チャットにアップロードできるファイルは？",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "チャットはテキスト、コード、CSV、JSON、画像を受け付け、対応するPDF、DOCX、XLSX、PPTXから読み取れるテキストを抽出します。プロジェクトのナレッジは対応するテキスト系ファイルを索引化します。抽出は10MBまでで、書式、スキャン内容、読めないページは省かれることがあります。ライブラリの元PDFプレビューは抽出テキストとは別で、Officeの元ファイルはダウンロードできますが表示はされません。",
    "How do I upload a file?": "ファイルをアップロードするには？",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "入力欄の添付ボタンから対応ファイルを選びます。準備が終わってから送信してください。",
    "Why did my upload fail?": "アップロードに失敗したのはなぜ？",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "再試行し、形式とサイズが対応しているか、接続と残りの利用枠を確認してください。再読み込みして1ファイルずつ試し、それでも失敗する場合はファイル形式とエラーを添えてサポートに連絡してください。",
    "Can KovaGPT analyze spreadsheets?": "スプレッドシートを分析できますか？",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "KovaGPTは対応するテキスト、CSV、JSON、画像を読み解き、表やグラフを表示できます。スプレッドシートやアップロードしたコードを実行する汎用環境はありません。",
    "Can KovaGPT understand uploaded images?": "アップロードした画像を理解できますか？",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "チャットは対応する画像を受け付け、見える内容を読み解きます。小さな文字や曖昧な部分は見落とすことがあるので、元の画像で確認してください。",
    "Are file limits different by plan?": "ファイルの上限はプランで違いますか？",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "はい。アップロードと保存の利用枠はプランごとに増えます。料金ページと製品内の使用状況をご確認ください。",
    "Can I remove a file before sending?": "送信前にファイルを外せますか？",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "はい。送信前に添付プレビューの削除ボタンを使います。",
    "How do I generate an image?": "画像を生成するには？",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "「画像」を開き、被写体・構図・スタイルを説明し、設定を選んで生成します。サインインと画像の利用枠が必要です。",
    "How should I describe the image I want?": "欲しい画像はどう説明すればいい？",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "被写体、場所、構図、照明、表現手法、入れたくないものを伝えます。曖昧な形容詞を並べるより明確な条件のほうが効果的です。",
    "Can I edit an existing image?": "既存の画像を編集できますか？",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "対応モデルでライブラリの画像を編集できます。任意の透過PNGマスクで変更箇所を指定できます。画像の利用枠が適用されます。",
    "Why was an image request rejected?": "画像の依頼が拒否されたのはなぜ？",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "安全ルール、無効な設定、非対応の元画像、プロバイダーの状況により拒否されることがあります。禁止内容を除いて依頼を修正し、対応する設定を使ってください。",
    "Why is image generation slow?": "画像生成が遅いのはなぜ？",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "生成時間はプロバイダーの負荷と設定によって変わります。ページを開いたままにし、エラー時だけ再試行し、重複した依頼は避けてください。",
    "Are image limits plan dependent?": "画像の上限はプランで違いますか？",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "はい。どのプランにも1日の画像上限があり、有料プランほど多くなります。",
    "What is Canvas?": "Canvasとは？",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "生成された文章、コード、ウェブサイトは、エクスポートとセッション内バージョン付きのエディタで開けます。エディタを閉じるとバージョンは保持されません。",
    "What are Projects?": "プロジェクトとは？",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "プロジェクトはチャット、ファイル、画像、メモ、タスク、プロジェクトメモリ、指示をまとめます。",
    "How do I create a project?": "プロジェクトを作るには？",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "サイドバーの「プロジェクト」→「新しいプロジェクト」で詳細を入力して作成します。",
    "How do I rename a project?": "プロジェクト名を変えるには？",
    "Open the project and use its settings or project menu to update the name.":
      "プロジェクトを開き、設定またはメニューから名前を変更します。",
    "How do I delete a project?": "プロジェクトを削除するには？",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "プロジェクト設定で「プロジェクトを削除」を選び確定します。プロジェクトの記録とファイルも削除されるので、確認内容をよく読んでください。",
    "How do I add chats to a project?": "プロジェクトにチャットを追加するには？",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "プロジェクト内でチャットを始めます。移動の操作がある場合は既存のチャットも割り当てられます。",
    "Can I upload files to a project?": "プロジェクトにファイルをアップロードできますか？",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "はい。プロジェクトのナレッジは対応ファイルを受け付けます（アップロードと保存の利用枠内）。",
    "Does project context carry across chats?": "プロジェクトの文脈はチャット間で共有されますか？",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "プロジェクトの指示、ナレッジ、メモ、メモリは、そのプロジェクトのチャットに文脈を与えます。重要な指示は明示し、重要な出力は確認してください。",
    "Can I share a project?": "プロジェクトを共有できますか？",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "オーナーは「メンバー」から共同作業者を招待できます。共同作業サービスが利用可能である必要があります。",
    "How do project invitations work?": "プロジェクトへの招待の仕組みは？",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "オーナーがメールアドレスに招待を送り、受信者は招待された本人としてサインインし、承諾してから参加します。",
    "Can someone without an account accept a project invitation?":
      "アカウントがない人も招待を承諾できますか？",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "参加するには招待された本人のKovaGPTアカウントが必要です。",
    "What happens when a collaborator is removed?": "共同作業者を外すとどうなる？",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "プロジェクトへのアクセスが取り消されます。以前にコピーやエクスポートした内容は回収されません。",
    "Can I leave a shared project?": "共有プロジェクトから抜けられますか？",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "オーナーにメンバーから外してもらってください。プロジェクトと内容はオーナーに残ります。",
    "Who owns a shared project?": "共有プロジェクトのオーナーは？",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "作成したアカウントが、明示的に変更が確認されない限りオーナーのままです。",
    "What is Library?": "ライブラリとは？",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "ライブラリには明示的に保存・アップロードしたものが入ります。すべての会話の自動コピーではありません。",
    "How do I save something to Library?": "ライブラリに保存するには？",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "対象の応答、画像、ファイルで「ライブラリに保存」を使います。保存・アップロードしたものだけが表示されます。",
    "Can I reopen or remove a Library item?":
      "ライブラリのアイテムを開き直したり削除したりできますか？",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "サイドバーからライブラリを開き、アイテムを選んで開くか削除します。削除は慎重に確認してください。",
    "Can I organize Library items?": "ライブラリを整理できますか？",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "はい。フォルダや一括移動で保存アイテムを整理できます。",
    "How do I share a chat?": "チャットを共有するには？",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "対象の会話で「共有」を使います。リンクを作成・送信する前にプレビューとアクセス設定を確認してください。",
    "Does a shared chat update automatically?": "共有したチャットは自動で更新されますか？",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "受信者に見える内容は共有プレビューが基準です。元の会話を変えたら再確認してください。",
    "Which apps can I connect?": "接続できるアプリは？",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "アプリページにはGoogle、Gmail、Googleドライブ、Googleカレンダー、GitHubがあります。各接続は認証情報、許可した範囲、サービスの状況によります。",
    "How do I connect an app?": "アプリを接続するには？",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "サイドバーから「アプリ」を開き、プロバイダーを選んで同意画面を確認します。理解した権限だけを許可してください。",
    "How do I disconnect or reconnect an app?": "アプリの接続解除・再接続は？",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "「アプリ」で接続中のサービスを選び「接続を解除」を選びます。再接続は接続手順をやり直し、必要な権限を許可します。",
    "Why does an integration ask for permission?": "連携で権限を求められるのはなぜ？",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "同意画面には必要な権限範囲が表示されます。KovaGPTは許可され、接続が対応するアクセスのみ使えます。",
    "What happens when I revoke access?": "アクセスを取り消すとどうなる？",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "新しい連携操作は使えなくなります。すでにチャットやプロジェクトに取り込んだデータは自動削除されないので、必要なら個別に削除してください。",
    "Why did a connected app stop working?": "接続したアプリが動かなくなったのはなぜ？",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "再試行し、「アプリ」で接続状態と権限を確認し、必要なら接続を解除して再接続してください。プロバイダーの障害や設定でも操作できないことがあります。",
    "How does Gmail integration work?": "Gmail連携の仕組みは？",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "「アプリ」からGmailを接続します。読み取り・書き込みの操作は、許可範囲、認証情報、サービスの状況によります。",
    "Can KovaGPT search my email or read attachments?":
      "メールの検索や添付ファイルの読み取りはできますか？",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "現在の接続と権限で可能なGmail操作だけを行えます。頼る前に操作内容と出典を確認してください。",
    "Can KovaGPT draft or send email?": "メールの下書きや送信はできますか？",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "Gmailへの書き込み操作は実行前に明示的な確認が必要です。KovaGPTが黙ってメールを送ることはありません。",
    "Can KovaGPT check or change my calendar?": "カレンダーの確認や変更はできますか？",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "Googleカレンダーの読み書きは許可範囲内でのみ可能です。予定の作成や変更は実行前に確認が必要です。",
    "Can KovaGPT search Google Drive?": "Googleドライブを検索できますか？",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "Googleドライブは「アプリ」から接続できます。検索と読み取りは許可範囲、対応ファイル、サービスの状況によります。",
    "Can KovaGPT modify Drive files?": "ドライブのファイルを変更できますか？",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "ドライブを自由に編集できるとは限りません。確認用に表示され、現在の接続が対応する操作だけが実行されます。",
    "How does GitHub integration work?": "GitHub連携の仕組みは？",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "「アプリ」からGitHubを接続し、権限範囲を確認します。リポジトリ操作は許可されたアクセスと連携の対応状況によります。",
    "What is Local places?": "ローカルの場所とは？",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "ローカルの場所はKovaGPTで予定しているマップ機能です。プロバイダー、法務、プライバシー、容量、費用の審査が承認されるまで利用できません。",
    "Can it search real places?": "実在の場所を検索できますか？",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "現在のバージョンではできません。マップが承認されれば審査済みの外部プロバイダーを検索できますが、情報は変わるので出かける前に必ず確認してください。",
    "Can it provide directions?": "道案内はできますか？",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "KovaGPTは道案内のために外部の地図アプリを開けます。独自のターンバイターンナビはありません。",
    "Does KovaGPT use my device location?": "デバイスの位置情報を使いますか？",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "マップが利用できない間は使いません。承認後も、明示的に位置情報の操作を選んだときだけ座標を求め、受け取るプロバイダーを示します。マップは設定に座標を保存しません。",
    "Why is Local places unavailable?": "ローカルの場所が使えないのはなぜ？",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "マップはプロバイダー、ライセンス、表記、プライバシー、容量、費用の承認待ちのため意図的に無効です。この状態では位置情報を求めず、地図プロバイダーも呼び出しません。",
    "Where are Settings?": "設定はどこ？",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "プロフィールメニューから「設定」を選びます。アカウント、パーソナライズ、メモリ、アプリ、サブスクリプション、プライバシー、外観などがあります。",
    "How do I change appearance?": "外観を変えるには？",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "プロフィールメニュー →「設定」→「外観」でテーマを選びます。",
    "Can I change how KovaGPT responds?": "KovaGPTの答え方を変えられますか？",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "パーソナライズ設定や、チャット・プロジェクトでの明示的な指示を使います。KovaGPTは対応する設定を今後の応答に反映します。",
    "What is Adaptive Memory?": "アダプティブメモリとは？",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "メモリはFreeでも使え、PlusとProではより多く保存できます。会話からの更新は任意で、保存したメモは編集・削除できます。一時チャットではメモリを使用・更新しません。",
    "How do I turn Memory off or delete it?": "メモリをオフにする・削除するには？",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "「設定」→「メモリ」を開きます。オフにすると新たな利用と保存を止め、「保存したメモリを削除」で保存内容を消せます。",
    "Is Memory the same as chat history?": "メモリはチャット履歴と同じですか？",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "いいえ。履歴は会話を保存し、アダプティブメモリはチャット間の選ばれた文脈を保存します。メモリをオフにしたり削除したりしても履歴や下書きは消えません。",
    "Does Temporary Chat use Memory?": "一時チャットはメモリを使いますか？",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "いいえ。一時チャットはメモリを使わず更新もせず、履歴にも残りません。",
    "How do notifications work?": "通知の仕組みは？",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "「通知」を開くと製品内の通知を確認できます。プッシュ通知には対応ブラウザ、許可、設定が必要です。",
    "What plans does KovaGPT offer?": "KovaGPTのプランは？",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "KovaGPTにはFree、Plus、Proがあります。法人向けは個別にご相談ください。範囲と条件は購入前に確認します。",
    "How much do Plus and Pro cost?": "PlusとProの料金は？",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "月額はPlusが16米ドル、Proが80米ドル（税別）です。購入前にStripeで最終金額を確認してください。",
    "How does the first-month discount work?": "初月割引の仕組みは？",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "対象アカウントはPlusまたはProの月額プランの初月が50%オフになります（1アカウント1回）。翌月以降は通常料金です。新規サブスクリプションに無料体験はなく、既存の体験は元の条件のままです。登録前にStripeで対象可否、初回支払い、更新額を確認できます。",
    "How do I upgrade or downgrade?": "プランの変更方法は？",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "「設定」→「請求」でプラン変更を選び、確定前に料金と適用日を確認してください。",
    "Where do I manage my subscription?": "サブスクリプションの管理場所は？",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "「設定」→「請求」→「サブスクリプションを管理」を選びます。Stripeポータルが使えない場合は表示されるサポートを使ってください。",
    "What payment methods are accepted?": "使える支払い方法は？",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "Stripeの決済画面に、アカウント・デバイス・地域で使える方法が表示されます。すべての方法がどこでも使えるわけではありません。",
    "Why did my payment fail?": "支払いに失敗したのはなぜ？",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "請求情報、残高、銀行の認証要求を確認して一度だけ再試行してください。Stripeが拒否し続ける場合は銀行またはサポートに連絡してください。",
    "Where are invoices and receipts?": "請求書と領収書はどこ？",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "「設定」→「請求」→「サブスクリプションを管理」でStripeの記録を確認できます。ポータルが使えない場合はアカウントのメールからサポートに連絡してください。",
    "Why was tax added?": "税金が加算されたのはなぜ？",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "Stripeが請求情報と適用ルールから税金を計算します。掲載価格は税別です。",
    "How do I update my payment method?": "支払い方法を変えるには？",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "「設定」→「請求」→「サブスクリプションを管理」からStripeポータルで変更します。使えない場合はサポートに連絡してください。",
    "Does my subscription renew automatically?": "サブスクリプションは自動更新されますか？",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "更新日と条件は決済画面とStripeポータルでご確認ください。",
    "How do I cancel?": "解約するには？",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "「設定」→「請求」→「サブスクリプションを管理」からStripeポータルで解約します。できない場合はアカウントのメールからサポートに連絡してください。",
    "What happens after cancellation?": "解約後はどうなる？",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "Stripeポータルで適用日を確認できます。有料プランが終わってもチャットは削除されませんが、有料機能と高い利用枠はプラン変更時に終了します。",
    "Are refunds available?": "返金はありますか？",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "返金ポリシーで対象を確認し、アカウントのメールと購入情報を添えてサポートに連絡してください。カード番号全体は書かないでください。",
    "Why is my upgraded plan not showing?": "アップグレードしたプランが表示されないのはなぜ？",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "「請求」を更新し、同じアカウントで購入が完了したか確認してから、サインアウトして再度サインインしてください。処理中は再購入せず、解決しなければサポートに連絡してください。",
    "How do usage limits work?": "利用上限の仕組みは？",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "Freeの利用はかなり限られています。Plusは利用枠が拡大し、Proは最大です。利用量はモデルやタスクで変わり、すべてのモデルに上限があります。次の更新は「使用状況」で確認できます。",
    "How does KovaGPT use my data?": "KovaGPTはデータをどう使いますか？",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "収集、処理、提供先、保存期間、選択肢については最新のプライバシーポリシーをご確認ください。",
    "Are my conversations private?": "会話はプライベートですか？",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "チャットはモードと同期状態に応じてアカウントまたはデバイスに結び付きます。秘密情報は入れず、共有前にプライバシーポリシーとプレビューを確認してください。",
    "What happens to uploaded files?": "アップロードしたファイルはどうなる？",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "使う機能（チャット、プロジェクト、ライブラリ）に応じて処理・保存されます。各機能の操作で削除でき、保存期間はプライバシーポリシーをご確認ください。",
    "What data do integrations share?": "連携ではどんなデータが共有されますか？",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "同意画面に許可した範囲が表示されます。依頼内容や操作の詳細は接続先に送られることがあります。アクセスは「アプリ」またはプロバイダー側で取り消せます。",
    "How do I export my data?": "データをエクスポートするには？",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "「設定」でデータのエクスポートを使い、完了を待ちます。使えない場合や失敗した場合はサポートに連絡してください。",
    "How do I delete my account?": "アカウントを削除するには？",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "「設定」→「データ管理」で「削除を予約」を選びます。30日間は「アカウントを復元」で元に戻せます。予約や復元では請求は止まらず、初月割引もリセットされません。必要なら「請求」で別途解約してください。",
    "What happens when I delete my account?": "アカウントを削除するとどうなる？",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "予約すると30日間の復元期間が始まり、アカウントやデータはまだ消えません。最終削除は期限後に始まり、サブスクリプションの終了と個人データの削除を確認してからサインインアカウントを削除します。保留中の表示は削除完了を意味しません。一部の請求・セキュリティ・法務・バックアップ・外部プロバイダーの記録はプライバシーポリシーに従い残る場合があります。",
    "Does KovaGPT support MFA?": "多要素認証に対応していますか？",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "サインイン方法が対応していれば、設定から多要素認証を管理できます。",
    "What should I do if someone accessed my account?": "誰かにアカウントへアクセスされたら？",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "まずメールやIDプロバイダーのアカウントを保護し、認証情報を変更し、見覚えのないセッションや連携を取り消し、多要素認証を有効にしてサポートに連絡してください。",
    "Can support see my password?": "サポートはパスワードを見られますか？",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "いいえ。パスワード、ワンタイムコード、パスキー、復旧コード、カード番号全体は絶対にサポートへ送らないでください。",
    "How do I contact KovaGPT about privacy?": "プライバシーについて問い合わせるには？",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "下のフォームで「プライバシーとセキュリティ」を選び、アカウントのメールから送信してください。support@kovagpt.com へのメールでも構いません。",
    "What are Scheduled Tasks?": "スケジュールタスクとは？",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "繰り返しやイベント駆動のワークフローの記録です。この環境ではバックグラウンド実行は使えませんが、保存済みのタスクは管理できます。",
    "Why can I not create a Scheduled Task?": "スケジュールタスクを作れないのはなぜ？",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "承認済みで稼働中のスケジューラが接続されるまでバックグラウンド実行は使えません。保存済みのタスクは管理できます。",
    "Can I edit, pause, or delete a saved task?":
      "保存したタスクを編集・一時停止・削除できますか？",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "サイドバーから「スケジュールタスク」を開き、各タスクの操作を使います。管理してもバックグラウンド実行は有効になりません。",
    "KovaGPT is slow or not responding.": "KovaGPTが遅い・反応しません。",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "一度再試行し、再読み込みして接続を確認し、重いタブを閉じてください。必要ならサインインし直し、干渉する拡張機能を無効にして、別のブラウザやデバイスを試してください。",
    "A message is stuck on Thinking.": "メッセージが「考え中」のまま止まっています。",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "応答を停止して一度再試行し、再読み込みして接続を確認してください。短い依頼や速いモードを試し、繰り返す場合は時刻とモードを添えてサポートに連絡してください。",
    "My message failed to send.": "メッセージが送信できませんでした。",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "一度再試行し、接続と残りの利用枠を確認して再読み込みしてください。非対応の添付を外し、サインインし直し、別のブラウザを試してからサポートに連絡してください。",
    "Search is not working.": "検索が使えません。",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "再試行し、検索が選択されているか確認して一般的な検索を試してください。再読み込みし、接続と利用枠を確認し、通信を妨げるブロッカーを無効にしてからサポートに連絡してください。",
    "An image will not generate.": "画像が生成されません。",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "対応する設定とポリシーに沿ったプロンプトで再試行してください。画像の利用枠と接続を確認して再読み込みし、別のブラウザを試してからサポートに連絡してください。",
    "Uploads keep failing.": "アップロードが失敗し続けます。",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "形式、サイズ、利用枠を確認し、1ファイルずつ再試行してください。再読み込みして接続を確認し、アップロードを妨げる拡張機能を外して別のブラウザを試してください。",
    "My subscription is not showing.": "サブスクリプションが表示されません。",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "「設定」→「請求」を更新し、購入したアカウントか確認してからサインインし直してください。二重購入はせず、表示されない場合は領収書を添えてサポートに連絡してください。",
    "The page looks broken or my sidebar disappeared.":
      "ページが崩れている、またはサイドバーが消えました。",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "再読み込みしてブラウザのズームをリセットし、ウィンドウを広げるかモバイルのナビゲーションを使ってください。ページを変更する拡張機能を無効にし、別のブラウザを試してください。",
    "Why is a feature missing on another device?": "別のデバイスで機能がないのはなぜ？",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "両方のデバイスで同じアカウント、プラン、バージョン、設定を使っているか確認してください。一部のブラウザ機能や未同期のローカルデータはデバイスごとです。",
    "I see an error message. What should I send support?":
      "エラーが表示されます。サポートに何を送ればいい？",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "正確なメッセージ、ページ、時刻、クリックした操作、期待した結果、ブラウザとデバイス、表示されているIDを送ってください。スクリーンショットから秘密情報と支払い情報は消してください。",
    "How do I contact support?": "サポートへの連絡方法は？",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "下のフォームか support@kovagpt.com へ。アカウントのメール、ページ、起きたこと、期待したことを記載してください。",
    "How do I report a bug?": "バグを報告するには？",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "下で「バグ報告」を選び、再現手順、結果、期待した結果、ブラウザとデバイス、エラーやIDを記載してください。",
    "Can I request a feature?": "機能をリクエストできますか？",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "はい。サポートフォームで「機能リクエスト」を選び、機密データは送らずに解決したい課題を説明してください。",
    "What should I never send support?": "サポートに絶対送ってはいけないものは？",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "パスワード、ワンタイムコード、パスキー、復旧コード、APIシークレット、カード番号全体は絶対に送らないでください。",
    "What is included in Free?": "Freeには何が含まれますか？",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "ごく限られた利用量でKovaGPTを試せます。Argon LiteとMedium（考え中）。プロジェクトでチャットを整理し、ライブラリでファイルや画像を探せます。チャットの利用量はごく限られ、すべてのモデルに上限があります。画像生成とアップロードは制限付き。クラウドストレージ付き。検索と画像生成はプロバイダーが利用可能な場合。有効時は基本メモリ。",
    "What is included in Plus?": "Plusには何が含まれますか？",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "Maxまでの7つのモデル（Lite、Medium、High、Extra High、Max）で利用枠が拡大。すべてのモデルに上限があります。プロジェクトでチャットを整理し、ライブラリでファイルや画像を探せます。画像生成とアップロードが拡大。クラウドストレージ付き。検索と画像生成はプロバイダーが利用可能な場合。有効時は強化メモリ。",
    "What is included in Pro?": "Proには何が含まれますか？",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "Ultraまでの7つのモデル（Lite、Medium、High、Extra High、Max、Ultra）で最大の利用枠。すべてのモデルに上限があります。プロジェクトでチャットを整理し、ライブラリでファイルや画像を探せます。画像生成とアップロードが拡大。クラウドストレージ付き。検索と画像生成はプロバイダーが利用可能な場合。有効時は拡張メモリ。",
    "Getting started": "はじめに",
    "Account & sign-in": "アカウントとサインイン",
    "Chat & modes": "チャットとモード",
    "Search & research": "検索とリサーチ",
    "Files & images": "ファイルと画像",
    "Library & sharing": "ライブラリと共有",
    "Apps & integrations": "アプリと連携",
    "Local places": "ローカルの場所",
    "Settings & memory": "設定とメモリ",
    "Billing & plans": "請求とプラン",
    "Privacy & security": "プライバシーとセキュリティ",
    Troubleshooting: "トラブルシューティング",
    "Contact & support": "お問い合わせとサポート",
    "Help categories": "ヘルプのカテゴリ",
    Back: "戻る",
    "KovaGPT Help Center": "KovaGPTヘルプセンター",
    "How can we help?": "どのようにお手伝いできますか？",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "回答を検索する、よくあるトピックを見る、KovaGPTサポートに連絡する。",
    "Search help…": "ヘルプを検索…",
    "Search help": "ヘルプを検索",
    "Try a different search or send us a message below.":
      "別の検索を試すか、下のフォームからご連絡ください。",
    "Show more answers": "回答をもっと見る",
    "Find a fix for your setup": "あなたの環境に合った解決策",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "問題、ブラウザ、接続、プラン、発生時期を選ぶと具体的な手順が表示されます。ヘルプ記事と設定確認を組み合わせたもので、あらゆる問題の報告ではありません。",
    "Your issue": "問題",
    "Help issue": "問題",
    "Browser & device": "ブラウザとデバイス",
    "Help browser": "ブラウザ",
    Connection: "接続",
    "Help connection": "接続",
    "Kova plan": "Kovaのプラン",
    "Help plan": "プラン",
    "When it started": "発生時期",
    "Help stage": "時期",
    "Troubleshooting steps": "解決の手順",
    "Loading support form…": "サポートフォームを読み込み中…",
    "Request accepted": "リクエストを受け付けました",
    "Send another message": "別のメッセージを送る",
    "Still need help?": "まだお困りですか？",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "答えが見つかりませんか？KovaGPTサポートにメッセージを送っていただければメールで返信します。",
    Optional: "任意",
    Topic: "トピック",
    "Choose a topic": "トピックを選択",
    "Tell us what happened, what you expected, and any error message you saw.":
      "何が起きたか、期待していたこと、表示されたエラーメッセージを教えてください。",
    "We’ll use your email only to respond to this support request.":
      "メールアドレスはこのお問い合わせへの返信にのみ使用します。",
    "Sending…": "送信中…",
    "Support request status": "お問い合わせの状況",
    "Your message is still here.": "メッセージは残っています。",
    Features: "機能",
    Learn: "学ぶ",
    Business: "ビジネス",
    Pricing: "料金",
    Review: "レビュー",
    "Open KovaGPT": "KovaGPTを開く",
    "Open app": "アプリを開く",
    "All projects": "すべてのプロジェクト",
    "My projects": "自分のプロジェクト",
    "Shared with me": "共有されたもの",
    "Browse answers": "回答を見る",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      "「解約」「ログインできない」「遅い」「Gmail」などで検索してみてください。",
  },
  ko: {
    "Why is Thinking blue?": "생각 중이 파란색인 이유는?",
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      "심층 추론이 켜지면 뇌 아이콘과 '생각 중'이 파란색이 됩니다. 같은 버튼을 다시 누르면 기본값으로 돌아갑니다. Free는 켜기/끄기만, Plus와 Pro는 추가 모델 단계를 제공합니다.",
    "How do I resize or color the sidebar?": "사이드바 크기나 색상을 바꾸려면?",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "데스크톱에서 사이드바 오른쪽 가장자리를 끌어 조정하세요. 가장자리에 포커스한 뒤 왼쪽/오른쪽 키도 쓸 수 있고 Home/End는 최소/최대 너비입니다. 더 보기 → 사이드바 사용자 지정에서 항목, 색상, 검색 위치, 최근 채팅 표시를 고르세요. 이 브라우저의 이 계정에 저장됩니다.",
    "How do I copy or remove a chat link?": "채팅 링크를 복사하거나 삭제하려면?",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "저장된 채팅에서 공유를 선택하면 공개 링크가 복사됩니다. 링크가 있는 사람은 30일 동안 스냅샷을 볼 수 있으며 파일과 이후 메시지는 제외됩니다. 링크 취소는 설정 → 데이터 제어에서 하세요. 성공 알림은 클립보드가 링크를 받은 경우에만 표시됩니다.",
    "The clipboard won't copy a share link.": "클립보드에 공유 링크가 복사되지 않습니다.",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "클립보드 접근이 실패하면 링크가 대화 상자에 표시됩니다. 링크를 선택해 직접 복사하거나 링크 복사를 다시 누르세요.",
    "Which image shapes and custom sizes can I use?": "어떤 이미지 모양과 크기를 쓸 수 있나요?",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "지원 모델에서 정사각형 1:1, 가로 3:2, 세로 2:3, 와이드 16:9, 스토리 9:16, 사용자 지정을 고를 수 있습니다. 사용자 지정 변은 16의 배수이고 최대 3840픽셀, 총 655,360–8,294,400픽셀, 비율 1:3–3:1이어야 합니다. 큰 이미지는 더 오래 걸릴 수 있습니다.",
    "How do I create an image in a normal chat?": "일반 채팅에서 이미지를 만들려면?",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "+ 메뉴에서 이미지 만들기를 선택하고 원하는 내용을 설명해 보내세요. 로그인과 이미지 사용 한도가 필요합니다. 결과는 대화에 남고 라이브러리에 저장할 수 있습니다.",
    "Why doesn't the activity panel show Cloud browser?":
      "활동 패널에 클라우드 브라우저가 보이지 않는 이유는?",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "패널은 이 대화에서 기록된 출처와 결과를 보여 줍니다. 브라우저 연동이 실제 세션 데이터를 제공하면 미리 보기와 탭 수가 나타납니다. 웹 검색만으로는 클라우드 브라우저가 활성화되지 않습니다.",
    "How much usage does each plan include?": "요금제별 사용량은 얼마인가요?",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "Free는 사용량이 매우 제한됩니다. Plus는 월 16달러로 더 많은 채팅을, Pro는 월 80달러로 가장 큰 한도를 제공합니다. 사용량은 모델과 작업에 따라 다르며 모든 모델에 한도가 있습니다.",
    "Scheduled tasks says access could not be verified.":
      "예약 작업에서 접근을 확인할 수 없다고 나옵니다.",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "한 번 새로고침하고 같은 계정으로 로그인했는지 확인하세요. 계속되면 지원팀이 작업 스키마와 접근 기능을 확인해야 합니다. 새로고침으로는 누락된 데이터베이스 마이그레이션이 고쳐지지 않습니다. 해결책으로 작업을 삭제하지 마세요.",
    "My task is saved but background execution isn't ready.":
      "작업은 저장됐지만 백그라운드 실행이 준비되지 않았습니다.",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "작업 상태와 시간대를 확인하세요. 예약 실행에는 구성된 공급자, 승인된 정책, 정상적인 스케줄러가 필요합니다. 서비스 문제가 표시되면 작업을 그대로 두고 지원팀에 문의하세요. 반복 실행은 중복 작업을 만들 수 있습니다.",
    "What is KovaGPT?": "KovaGPT란?",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "KovaGPT는 대화, 웹 조사, 지원 파일, 이미지, 프로젝트, 연결된 앱을 위한 AI 작업 공간입니다. 사용 가능 여부는 요금제와 구성된 공급자에 따라 다릅니다.",
    "What should I try first?": "무엇부터 해 보면 좋을까요?",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "새 채팅을 시작해 구체적인 질문을 하거나 원하는 결과를 설명하세요. 계속되는 작업은 사이드바의 프로젝트에서 채팅, 지침, 파일을 함께 관리하세요.",
    "How do I start a new chat?": "새 채팅을 시작하려면?",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "사이드바에서 새 채팅을 선택하고, 모드나 도구를 고른 뒤 메시지를 입력해 보내세요.",
    "Where are my previous chats?": "이전 채팅은 어디에 있나요?",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "로그인한 일반 채팅은 동기화가 가능할 때 계정과 동기화됩니다. 오프라인 편집은 확인될 때까지 이 기기에 남고, 임시 채팅은 기록에 남지 않습니다.",
    "Can I use KovaGPT without an account?": "계정 없이 사용할 수 있나요?",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "채팅, 이미지 생성·편집, 라이브러리 관리, 도구 사용에는 인증된 계정이 필요합니다. 로그인 또는 계정 만들기를 선택하세요. 도움말, 요금, 법적 정보, 보기 전용 공유 링크는 공개됩니다.",
    "Does KovaGPT work on mobile?": "모바일에서도 되나요?",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "네. KovaGPT는 화면에 맞게 표시되며, 지원 브라우저에서는 웹 앱으로 설치할 수 있습니다.",
    "Which browsers are supported?": "지원되는 브라우저는?",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "최신 버전의 최신 브라우저를 사용하세요. 패스키, 설치, 푸시 알림 같은 기능이 없다면 브라우저를 업데이트하거나 다른 브라우저를 써 보세요.",
    "How do I create an account?": "계정을 만들려면?",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "로그인을 선택한 뒤 사용 가능한 공급자나 이메일로 계속하세요. 활성화된 방법만 표시됩니다.",
    "How do I change my display name or profile image?": "표시 이름이나 프로필 사진을 바꾸려면?",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "프로필 메뉴 → 설정 → 계정에서 가능한 항목을 수정하세요. 공급자가 관리하는 정보는 해당 공급자에서 바꿔야 합니다.",
    "How do I change my password?": "비밀번호를 바꾸려면?",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "이메일 로그인 화면에서 비밀번호 찾기를 선택하세요. Google 등 외부 공급자로 만든 계정은 해당 공급자에서 비밀번호를 관리합니다.",
    "How does Google sign-in work?": "Google 로그인은 어떻게 작동하나요?",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "Google로 계속을 선택하고 로그인 요청을 승인하세요. KovaGPT는 Google 비밀번호를 받지 않습니다.",
    "Why did Google sign-in fail?": "Google 로그인이 실패한 이유는?",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "다시 시도하고 페이지를 새로고침한 뒤 로그인 창을 허용하고 쿠키가 차단되지 않았는지 확인하세요. 그래도 안 되면 다른 브라우저를 써 보고 지원팀에 문의하세요.",
    "I cannot sign in. What should I try?": "로그인이 안 됩니다. 어떻게 하나요?",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "한 번 다시 시도하고 새로고침한 뒤 연결을 확인하고 새 로그인 또는 비밀번호 재설정 이메일을 요청하세요. 개인정보 차단 기능을 확인하고 다른 브라우저나 기기를 써 본 뒤 지원팀에 문의하세요.",
    "Why did my sign-in email not arrive?": "로그인 이메일이 오지 않는 이유는?",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "스팸과 프로모션함을 확인하고 주소를 확인한 뒤 새 이메일을 요청하세요. 오래되거나 만료된 링크는 작동하지 않을 수 있으니 최신 링크만 사용하세요.",
    "Does KovaGPT support passkeys?": "패스키를 지원하나요?",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "패스키 로그인은 활성화되어 있고 브라우저와 기기가 지원할 때 사용할 수 있습니다. 등록된 패스키는 설정에서 관리하세요.",
    "How do I send a message?": "메시지를 보내려면?",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "입력창에 작성하고 보내기를 누르거나 단축키를 사용하세요. 필요하면 보내기 전에 컨텍스트를 첨부하세요.",
    "How do I stop a response?": "응답을 멈추려면?",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "응답 생성 중에는 보내기 대신 중지 버튼이 표시됩니다. 중지해도 받은 내용은 남습니다.",
    "Can I regenerate an answer?": "답변을 다시 생성할 수 있나요?",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "완료되거나 실패한 응답에 표시되는 다시 시도를 사용하세요. 결과가 달라질 수 있으니 중요한 내용은 확인하세요.",
    "Can I edit a previous message?": "이전 메시지를 편집할 수 있나요?",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "메시지에 표시되는 편집을 사용하세요. 편집하면 그 지점부터 새 흐름이 만들어져 이후 맥락이 바뀔 수 있습니다.",
    "How do I copy an answer?": "답변을 복사하려면?",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "응답의 복사 작업을 사용하세요. 생성된 항목은 편집기나 내보내기를 사용하세요.",
    "How do I rename or delete a conversation?": "대화 이름 바꾸기나 삭제는?",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "기록에서 대화 메뉴를 열고 이름 바꾸기 또는 삭제를 선택하세요. 삭제한 대화는 복구되지 않을 수 있으니 신중히 확인하세요.",
    "Why can KovaGPT make mistakes?": "KovaGPT가 실수하는 이유는?",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "AI 답변은 불완전하거나 틀릴 수 있습니다. 특히 의료, 법률, 금융, 안전 관련 결정에서는 중요한 주장, 계산, 출처를 확인하세요.",
    "Does a new chat remember an earlier chat?": "새 채팅이 이전 채팅을 기억하나요?",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "일반 채팅 간에 맥락을 이어주는 것은 적응형 메모리뿐이며, 활성화 시 로그인한 Plus와 Pro 사용자가 쓸 수 있습니다. 그 외에는 새 채팅마다 자체 맥락으로 시작합니다.",
    "Why did a long conversation lose context?": "긴 대화에서 맥락이 사라진 이유는?",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "매우 긴 대화는 모델의 맥락 한도를 넘을 수 있습니다. 중요한 내용을 다시 말하거나 간단한 자료를 첨부하거나 요약과 함께 새 채팅을 시작하세요.",
    "What is Lite mode?": "Lite 모드란?",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      "기본값이 가장 빠른 설정입니다. Free는 뇌 모양의 생각 중 버튼으로 심층 추론을 켜거나 끕니다. Plus는 Medium과 High, Pro는 Extra High, Max, Ultra가 추가됩니다. 계정이 필요합니다.",
    "What is Medium mode?": "Medium 모드란?",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "Medium은 같은 모델에 Lite보다 더 많은 작업 시간을 줍니다. Plus와 Pro에서 사용할 수 있습니다.",
    "What is Thinking mode?": "Thinking 모드란?",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "Thinking은 Plus의 고강도 모드 이름으로, 같은 모델에 Medium보다 더 많은 시간을 줍니다.",
    "What is High mode?": "High 모드란?",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "High는 Pro의 고강도 모드 이름이며 Pro에서 사용할 수 있습니다.",
    "What is Extra High mode?": "Extra High 모드란?",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "Extra High는 같은 모델에 분석, 확인, 수정 시간을 제한적으로 더 줍니다. Pro에서 사용할 수 있습니다.",
    "What is Max mode?": "Max 모드란?",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "Max는 어려운 요청에 같은 모델로 더 큰 작업량을 사용합니다. Pro에서 사용할 수 있습니다.",
    "What is Ultra mode?": "Ultra 모드란?",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "Ultra는 Pro의 가장 깊은 단계로, 같은 모델 위에서 제한된 하위 에이전트를 조율할 수 있습니다.",
    "Which modes are on each plan?": "요금제별 모드는?",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "Free는 Lite와 Medium, Plus는 Lite, Medium, High, Extra High, Max, Pro는 여기에 Ultra를 포함합니다. 이전 Kova 세대도 기존 작업을 위해 계속 사용할 수 있습니다.",
    "Why do I not see every mode?": "모든 모드가 보이지 않는 이유는?",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "모드는 현재 요금제와 서비스 준비 상태에 따라 다릅니다. 요금제 변경 후 새로고침하세요. 결제에 새 요금제가 보이는데 모드가 없다면 로그아웃 후 다시 로그인하고 지원팀에 문의하세요.",
    "Do more capable modes take longer?": "더 강력한 모드는 더 오래 걸리나요?",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "그럴 수 있습니다. 특히 복잡한 요청에서는 고강도 모드가 Lite나 Medium보다 오래 걸릴 수 있습니다.",
    "What does Search do?": "검색은 무엇을 하나요?",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "검색은 공급자가 사용 가능할 때 최신 웹 출처를 가져옵니다. 인용된 링크를 열어 답변을 뒷받침하는지 확인하세요.",
    "When should I use Search?": "검색은 언제 쓰나요?",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "최신 소식, 최근 제품 정보, 실시간 공개 정보, 웹 출처가 필요할 때 사용하세요. 다시 쓰기나 직접 제공한 텍스트에 대한 질문에는 보통 필요 없습니다.",
    "Does Search browse the live web?": "검색은 실시간 웹을 탐색하나요?",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "공급자가 사용 가능하면 최신 출처를 가져올 수 있습니다. 연결된 페이지가 기준입니다.",
    "Can KovaGPT cite sources?": "출처를 인용할 수 있나요?",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "검색은 링크된 출처를 반환할 수 있습니다. 각 인용을 열어 해당 주장을 뒷받침하는지 확인하세요.",
    "Why might two searches differ?": "두 검색 결과가 다른 이유는?",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "웹페이지와 순위는 바뀌고, 표현이 다르면 다른 근거가 나올 수 있습니다. 요약만 믿지 말고 인용을 비교하세요.",
    "Why is Search unavailable?": "검색을 쓸 수 없는 이유는?",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "검색은 공급자와 남은 한도에 따라 달라집니다. 새로고침하고 도구가 선택됐는지 확인한 뒤 다시 시도하세요. 계속 안 되면 지원팀에 문의하세요.",
    "What files can I upload to chat?": "채팅에 올릴 수 있는 파일은?",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "채팅은 텍스트, 코드, CSV, JSON, 이미지를 받고, 지원되는 PDF, DOCX, XLSX, PPTX에서 읽을 수 있는 텍스트를 추출합니다. 프로젝트 지식은 지원되는 텍스트 파일을 색인합니다. 추출은 10MB로 제한되며 서식, 스캔 내용, 읽을 수 없는 페이지는 빠질 수 있습니다. 라이브러리의 원본 PDF 미리 보기는 추출 텍스트와 별개이며, Office 원본은 다운로드는 되지만 표시되지 않습니다.",
    "How do I upload a file?": "파일을 올리려면?",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "입력창의 첨부 버튼으로 지원 파일을 선택하세요. 준비가 끝난 뒤 보내세요.",
    "Why did my upload fail?": "업로드가 실패한 이유는?",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "다시 시도하고 형식과 크기, 연결, 남은 한도를 확인하세요. 새로고침 후 파일을 하나씩 올려 보고, 계속 실패하면 파일 형식과 오류를 알려 지원팀에 문의하세요.",
    "Can KovaGPT analyze spreadsheets?": "스프레드시트를 분석할 수 있나요?",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "KovaGPT는 지원되는 텍스트, CSV, JSON, 이미지를 분석하고 표나 차트를 보여 줄 수 있습니다. 스프레드시트나 업로드한 코드를 실행하는 일반 환경은 제공하지 않습니다.",
    "Can KovaGPT understand uploaded images?": "업로드한 이미지를 이해하나요?",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "채팅은 지원 이미지를 받아 보이는 내용을 분석합니다. 작은 글자나 모호한 부분은 놓칠 수 있으니 원본과 비교하세요.",
    "Are file limits different by plan?": "파일 한도는 요금제마다 다른가요?",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "네. 업로드와 저장 한도는 요금제에 따라 늘어납니다. 요금 페이지와 제품 내 사용량을 확인하세요.",
    "Can I remove a file before sending?": "보내기 전에 파일을 뺄 수 있나요?",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "네. 보내기 전에 첨부 미리 보기의 제거 버튼을 사용하세요.",
    "How do I generate an image?": "이미지를 생성하려면?",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "이미지를 열고 주제, 구도, 스타일을 설명한 뒤 설정을 골라 생성하세요. 로그인과 이미지 한도가 필요합니다.",
    "How should I describe the image I want?": "원하는 이미지를 어떻게 설명하나요?",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "주제, 배경, 구도, 조명, 표현 방식, 제외할 요소를 적으세요. 막연한 형용사보다 명확한 조건이 더 잘 통합니다.",
    "Can I edit an existing image?": "기존 이미지를 편집할 수 있나요?",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "지원 모델로 라이브러리 이미지를 편집하세요. 선택 사항인 투명 PNG 마스크로 변경 부분을 지정할 수 있습니다. 이미지 한도가 적용됩니다.",
    "Why was an image request rejected?": "이미지 요청이 거부된 이유는?",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "안전 규칙, 잘못된 설정, 지원되지 않는 원본 이미지, 공급자 상황 때문에 거부될 수 있습니다. 금지된 내용 없이 요청을 고치고 지원 설정을 사용하세요.",
    "Why is image generation slow?": "이미지 생성이 느린 이유는?",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "생성 시간은 공급자 부하와 설정에 따라 다릅니다. 페이지를 열어 두고 오류가 났을 때만 다시 시도하며 중복 요청은 피하세요.",
    "Are image limits plan dependent?": "이미지 한도는 요금제에 따라 다른가요?",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "네. 모든 요금제에 일일 이미지 한도가 있으며 유료 요금제가 더 많습니다.",
    "What is Canvas?": "캔버스란?",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "생성된 글, 코드, 웹사이트는 내보내기와 세션 버전이 있는 편집기에서 열 수 있습니다. 편집기를 닫으면 버전은 유지되지 않습니다.",
    "What are Projects?": "프로젝트란?",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "프로젝트는 채팅, 파일, 이미지, 메모, 작업, 프로젝트 메모리, 지침을 정리합니다.",
    "How do I create a project?": "프로젝트를 만들려면?",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "사이드바에서 프로젝트 → 새 프로젝트를 선택하고 정보를 입력해 만드세요.",
    "How do I rename a project?": "프로젝트 이름을 바꾸려면?",
    "Open the project and use its settings or project menu to update the name.":
      "프로젝트를 열고 설정이나 메뉴에서 이름을 바꾸세요.",
    "How do I delete a project?": "프로젝트를 삭제하려면?",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "프로젝트 설정에서 프로젝트 삭제를 선택하고 확인하세요. 프로젝트 기록과 파일도 삭제되니 확인 내용을 잘 읽으세요.",
    "How do I add chats to a project?": "프로젝트에 채팅을 추가하려면?",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "프로젝트 안에서 채팅을 시작하세요. 이동 옵션이 있으면 기존 채팅도 지정할 수 있습니다.",
    "Can I upload files to a project?": "프로젝트에 파일을 올릴 수 있나요?",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "네. 프로젝트 지식은 업로드·저장 한도 안에서 지원 파일을 받습니다.",
    "Does project context carry across chats?": "프로젝트 맥락이 채팅 간에 이어지나요?",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "프로젝트 지침, 지식, 메모, 메모리가 그 프로젝트의 채팅에 맥락을 제공합니다. 중요한 지침은 명시하고 중요한 결과는 확인하세요.",
    "Can I share a project?": "프로젝트를 공유할 수 있나요?",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "소유자는 구성원에서 공동 작업자를 초대할 수 있습니다. 협업 서비스가 사용 가능해야 합니다.",
    "How do project invitations work?": "프로젝트 초대는 어떻게 작동하나요?",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "소유자가 이메일로 초대를 보내면, 받은 사람은 초대된 계정으로 로그인해 수락한 뒤 접근합니다.",
    "Can someone without an account accept a project invitation?":
      "계정이 없는 사람도 초대를 수락할 수 있나요?",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "참여하려면 초대된 신원과 연결된 KovaGPT 계정이 필요합니다.",
    "What happens when a collaborator is removed?": "공동 작업자를 제거하면?",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "프로젝트 접근이 취소됩니다. 이전에 복사하거나 내보낸 내용은 회수되지 않습니다.",
    "Can I leave a shared project?": "공유 프로젝트에서 나갈 수 있나요?",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "소유자에게 구성원에서 제거해 달라고 요청하세요. 프로젝트와 내용은 소유자에게 남습니다.",
    "Who owns a shared project?": "공유 프로젝트의 소유자는?",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "만든 계정이 소유자이며, 변경이 명시적으로 확인되지 않는 한 유지됩니다.",
    "What is Library?": "라이브러리란?",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "라이브러리에는 직접 저장하거나 업로드한 항목만 있으며, 모든 대화의 자동 사본이 아닙니다.",
    "How do I save something to Library?": "라이브러리에 저장하려면?",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "응답, 이미지, 파일에서 라이브러리에 저장을 사용하세요. 저장하거나 업로드한 항목만 표시됩니다.",
    "Can I reopen or remove a Library item?": "라이브러리 항목을 다시 열거나 지울 수 있나요?",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "사이드바에서 라이브러리를 열고 항목을 선택해 열거나 삭제하세요. 삭제는 신중히 확인하세요.",
    "Can I organize Library items?": "라이브러리를 정리할 수 있나요?",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "네. 폴더와 일괄 이동으로 저장 항목을 정리할 수 있습니다.",
    "How do I share a chat?": "채팅을 공유하려면?",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "대화에서 공유를 사용하세요. 링크를 만들거나 보내기 전에 미리 보기와 접근 설정을 확인하세요.",
    "Does a shared chat update automatically?": "공유한 채팅은 자동으로 업데이트되나요?",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "받는 사람이 볼 내용은 공유 미리 보기가 기준입니다. 원래 대화를 바꾼 뒤 다시 확인하세요.",
    "Which apps can I connect?": "어떤 앱을 연결할 수 있나요?",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "앱 페이지에는 Google, Gmail, Google Drive, Google Calendar, GitHub가 있습니다. 각 연결은 자격 증명, 허용 범위, 서비스 상태에 따라 다릅니다.",
    "How do I connect an app?": "앱을 연결하려면?",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "사이드바에서 앱을 열고 공급자를 선택해 동의 화면을 확인하세요. 이해한 권한만 승인하세요.",
    "How do I disconnect or reconnect an app?": "앱 연결을 해제하거나 다시 연결하려면?",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "앱에서 연결된 서비스를 선택해 연결 해제를 누르세요. 다시 연결하려면 연결 과정을 다시 시작하고 필요한 권한을 승인하세요.",
    "Why does an integration ask for permission?": "연동이 권한을 요청하는 이유는?",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "동의 화면에 필요한 권한이 표시됩니다. KovaGPT는 허용되고 연결이 지원하는 접근만 사용합니다.",
    "What happens when I revoke access?": "접근 권한을 취소하면?",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "새 연동 작업이 중지됩니다. 이미 가져온 데이터는 자동 삭제되지 않으니 필요하면 따로 지우세요.",
    "Why did a connected app stop working?": "연결된 앱이 작동하지 않는 이유는?",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "다시 시도하고 앱에서 연결 상태와 권한을 확인한 뒤 필요하면 다시 연결하세요. 공급자 장애나 구성 때문에 작업이 안 될 수도 있습니다.",
    "How does Gmail integration work?": "Gmail 연동은 어떻게 작동하나요?",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "앱에서 Gmail을 연결하세요. 읽기·쓰기 작업은 권한, 자격 증명, 서비스 상태에 따라 다릅니다.",
    "Can KovaGPT search my email or read attachments?":
      "이메일 검색이나 첨부 파일 읽기가 가능한가요?",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "현재 연결과 권한이 허용하는 Gmail 작업만 수행합니다. 믿기 전에 작업과 출처를 확인하세요.",
    "Can KovaGPT draft or send email?": "이메일 초안 작성이나 발송이 가능한가요?",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "Gmail 쓰기 작업은 실행 전에 명시적 확인이 필요합니다. KovaGPT는 몰래 메일을 보내지 않습니다.",
    "Can KovaGPT check or change my calendar?": "캘린더를 확인하거나 바꿀 수 있나요?",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "Google Calendar는 허용된 권한 안에서만 읽거나 씁니다. 일정 생성·변경은 실행 전에 확인이 필요합니다.",
    "Can KovaGPT search Google Drive?": "Google Drive를 검색할 수 있나요?",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "Google Drive는 앱에서 연결합니다. 검색과 읽기는 권한, 지원 파일, 서비스 상태에 따라 다릅니다.",
    "Can KovaGPT modify Drive files?": "Drive 파일을 수정할 수 있나요?",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "일반적인 Drive 편집을 기대하지 마세요. 확인을 위해 표시되고 연결이 지원하는 작업만 실행됩니다.",
    "How does GitHub integration work?": "GitHub 연동은 어떻게 작동하나요?",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "앱에서 GitHub를 연결하고 권한을 확인하세요. 저장소 작업은 허용된 접근과 연동 지원에 따라 다릅니다.",
    "What is Local places?": "지역 장소란?",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "지역 장소는 KovaGPT에 계획된 지도 기능입니다. 공급자, 법률, 개인정보, 용량, 비용 검토가 승인될 때까지 사용할 수 없습니다.",
    "Can it search real places?": "실제 장소를 검색할 수 있나요?",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "현재 버전에서는 안 됩니다. 지도가 승인되면 검토된 외부 공급자를 검색할 수 있지만, 정보가 바뀔 수 있으니 방문 전에 꼭 확인하세요.",
    "Can it provide directions?": "길 안내가 되나요?",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "KovaGPT는 길 안내를 위해 외부 지도를 열 수 있지만, 자체 내비게이션은 제공하지 않습니다.",
    "Does KovaGPT use my device location?": "기기 위치를 사용하나요?",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "지도를 사용할 수 없는 동안은 사용하지 않습니다. 승인 후에도 직접 위치 버튼을 누를 때만 좌표를 요청하고, 받는 공급자를 알려 드립니다. 지도는 설정에 좌표를 저장하지 않습니다.",
    "Why is Local places unavailable?": "지역 장소를 쓸 수 없는 이유는?",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "지도는 공급자, 라이선스, 출처 표기, 개인정보, 용량, 비용 승인을 기다리는 동안 의도적으로 꺼져 있습니다. 이 상태에서는 위치를 요청하거나 지도 공급자를 호출하지 않습니다.",
    "Where are Settings?": "설정은 어디에 있나요?",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "프로필 메뉴에서 설정을 선택하세요. 계정, 개인 맞춤, 메모리, 앱, 구독, 개인정보, 화면 표시 등이 있습니다.",
    "How do I change appearance?": "화면 표시를 바꾸려면?",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "프로필 메뉴 → 설정 → 화면 표시에서 테마를 고르세요.",
    "Can I change how KovaGPT responds?": "KovaGPT의 응답 방식을 바꿀 수 있나요?",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "개인 맞춤 설정과 채팅이나 프로젝트의 명시적 지시를 사용하세요. KovaGPT가 이후 응답에 반영합니다.",
    "What is Adaptive Memory?": "적응형 메모리란?",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "메모리는 Free에서도 쓸 수 있고 Plus와 Pro는 더 많은 용량을 제공합니다. 대화 업데이트는 선택이며 저장된 메모는 편집·삭제할 수 있습니다. 임시 채팅은 메모리를 쓰지 않습니다.",
    "How do I turn Memory off or delete it?": "메모리를 끄거나 지우려면?",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "설정 → 메모리를 여세요. 끄면 사용과 새 저장이 중지되고, 저장된 메모리 삭제로 내용을 지울 수 있습니다.",
    "Is Memory the same as chat history?": "메모리와 채팅 기록은 같은가요?",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "아니요. 기록은 대화를, 적응형 메모리는 채팅 간 선택된 맥락을 저장합니다. 메모리를 끄거나 지워도 기록과 초안은 지워지지 않습니다.",
    "Does Temporary Chat use Memory?": "임시 채팅은 메모리를 사용하나요?",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "아니요. 임시 채팅은 메모리를 쓰거나 업데이트하지 않으며 기록에도 남지 않습니다.",
    "How do notifications work?": "알림은 어떻게 작동하나요?",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "알림을 열어 확인하세요. 푸시 알림에는 지원 브라우저, 권한, 구성이 필요합니다.",
    "What plans does KovaGPT offer?": "KovaGPT 요금제는?",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "KovaGPT는 Free, Plus, Pro를 제공합니다. 기업 요구 사항은 별도로 논의하며 범위와 조건은 구매 전에 확정됩니다.",
    "How much do Plus and Pro cost?": "Plus와 Pro의 가격은?",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "월 가격은 Plus 16달러, Pro 80달러(세금 별도)입니다. 구매 전에 Stripe에서 최종 금액을 확인하세요.",
    "How does the first-month discount work?": "첫 달 할인은 어떻게 되나요?",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "대상 계정은 Plus 또는 Pro 월간 구독 첫 달 50% 할인을 계정당 한 번 받습니다. 이후에는 정가가 적용됩니다. 새 구독에는 무료 체험이 없으며 기존 체험은 원래 조건을 유지합니다. 구독 전에 Stripe에서 대상 여부, 첫 결제, 갱신 금액을 확인합니다.",
    "How do I upgrade or downgrade?": "요금제를 바꾸려면?",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "설정 → 결제에서 변경할 요금제를 고르고, 확인 전에 가격과 적용일을 확인하세요.",
    "Where do I manage my subscription?": "구독은 어디서 관리하나요?",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "설정 → 결제에서 구독 관리를 선택하세요. Stripe 포털이 없으면 표시된 지원 옵션을 사용하세요.",
    "What payment methods are accepted?": "어떤 결제 수단을 쓸 수 있나요?",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "Stripe 결제 화면에 계정, 기기, 지역에 맞는 결제 수단이 표시됩니다. 모든 수단을 어디서나 쓸 수 있는 것은 아닙니다.",
    "Why did my payment fail?": "결제가 실패한 이유는?",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "결제 정보, 잔액, 은행 인증 요청을 확인하고 한 번 다시 시도하세요. 계속 거절되면 은행이나 지원팀에 문의하세요.",
    "Where are invoices and receipts?": "청구서와 영수증은 어디 있나요?",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "설정 → 결제 → 구독 관리에서 Stripe 기록을 볼 수 있습니다. 포털이 안 되면 계정 이메일로 지원팀에 문의하세요.",
    "Why was tax added?": "세금이 붙은 이유는?",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "Stripe가 결제 정보와 규정에 따라 세금을 계산합니다. 표시된 가격은 세금 별도입니다.",
    "How do I update my payment method?": "결제 수단을 바꾸려면?",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "설정 → 결제 → 구독 관리에서 Stripe 포털을 사용하세요. 안 되면 지원팀에 문의하세요.",
    "Does my subscription renew automatically?": "구독은 자동 갱신되나요?",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "갱신일과 조건은 결제 화면과 Stripe 포털에서 확인하세요.",
    "How do I cancel?": "해지하려면?",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "설정 → 결제 → 구독 관리에서 Stripe 포털로 해지하세요. 직접 할 수 없으면 계정 이메일로 지원팀에 문의하세요.",
    "What happens after cancellation?": "해지 후에는 어떻게 되나요?",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "Stripe 포털에서 적용일을 확인합니다. 구독이 끝나도 채팅은 삭제되지 않지만 유료 기능과 높은 한도는 요금제 변경 시 종료됩니다.",
    "Are refunds available?": "환불이 되나요?",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "환불 정책에서 대상 여부를 확인한 뒤 계정 이메일과 구매 정보로 지원팀에 문의하세요. 카드 번호 전체는 적지 마세요.",
    "Why is my upgraded plan not showing?": "업그레이드한 요금제가 안 보이는 이유는?",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "결제를 새로고침하고 같은 계정으로 구매가 완료됐는지 확인한 뒤 다시 로그인하세요. 처리 중에는 재구매하지 말고, 계속 다르면 지원팀에 문의하세요.",
    "How do usage limits work?": "사용 한도는 어떻게 작동하나요?",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "Free는 사용량이 매우 제한됩니다. Plus는 더 많이, Pro는 가장 많이 쓸 수 있습니다. 모델과 작업에 따라 다르며 모든 모델에 한도가 있습니다. 다음 갱신은 사용량에서 확인하세요.",
    "How does KovaGPT use my data?": "KovaGPT는 내 데이터를 어떻게 사용하나요?",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "수집, 처리, 공급자, 보관, 선택권은 최신 개인정보처리방침을 확인하세요.",
    "Are my conversations private?": "대화는 비공개인가요?",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "채팅은 모드와 동기화 상태에 따라 계정이나 기기에 연결됩니다. 비밀은 입력하지 말고, 공유 전에 개인정보처리방침과 미리 보기를 확인하세요.",
    "What happens to uploaded files?": "업로드한 파일은 어떻게 되나요?",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "사용하는 기능(채팅, 프로젝트, 라이브러리)에 맞게 처리·저장됩니다. 해당 기능에서 삭제할 수 있으며 보관 기간은 개인정보처리방침을 확인하세요.",
    "What data do integrations share?": "연동은 어떤 데이터를 공유하나요?",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "동의 화면에 허용 권한이 표시됩니다. 요청 내용과 작업 정보가 공급자에게 전달될 수 있으며, 앱이나 공급자에서 접근을 취소할 수 있습니다.",
    "How do I export my data?": "데이터를 내보내려면?",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "설정에서 데이터 내보내기를 사용하고 완료될 때까지 기다리세요. 없거나 실패하면 지원팀에 문의하세요.",
    "How do I delete my account?": "계정을 삭제하려면?",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "설정 → 데이터 제어에서 삭제 예약을 선택하세요. 30일 동안 계정 복구로 되돌릴 수 있습니다. 예약이나 복구로 결제가 취소되거나 첫 달 할인이 초기화되지 않으니 필요하면 결제에서 따로 해지하세요.",
    "What happens when I delete my account?": "계정을 삭제하면 어떻게 되나요?",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "예약하면 30일 복구 기간이 시작되며 계정과 데이터는 아직 지워지지 않습니다. 최종 정리는 기한 후 시작되며 구독 종료와 개인 데이터 정리를 확인한 뒤 로그인 계정을 삭제합니다. 대기 상태는 삭제 완료를 뜻하지 않습니다. 일부 결제, 보안, 법률, 백업, 외부 공급자 기록은 개인정보처리방침에 따라 남을 수 있습니다.",
    "Does KovaGPT support MFA?": "다단계 인증을 지원하나요?",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "로그인 방식이 지원하면 설정에서 다단계 인증을 관리할 수 있습니다.",
    "What should I do if someone accessed my account?": "누군가 내 계정에 접근했다면?",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "먼저 이메일이나 ID 공급자 계정을 보호하고, 자격 증명을 바꾸고, 모르는 세션이나 연동을 취소하고, 다단계 인증을 켠 뒤 지원팀에 문의하세요.",
    "Can support see my password?": "지원팀이 비밀번호를 볼 수 있나요?",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "아니요. 비밀번호, 일회용 코드, 패스키, 복구 코드, 카드 번호 전체는 절대 보내지 마세요.",
    "How do I contact KovaGPT about privacy?": "개인정보 관련 문의는 어떻게 하나요?",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "아래 양식에서 개인정보 및 보안을 선택하고 계정 이메일로 보내세요. support@kovagpt.com으로 이메일을 보내도 됩니다.",
    "What are Scheduled Tasks?": "예약 작업이란?",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "반복되거나 이벤트 기반인 작업의 기록입니다. 이 배포에서는 백그라운드 실행을 쓸 수 없지만 저장된 작업은 관리할 수 있습니다.",
    "Why can I not create a Scheduled Task?": "예약 작업을 만들 수 없는 이유는?",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "승인되고 작동 중인 스케줄러가 연결될 때까지 예약 실행을 쓸 수 없습니다. 저장된 작업은 관리할 수 있습니다.",
    "Can I edit, pause, or delete a saved task?":
      "저장된 작업을 편집, 일시 중지, 삭제할 수 있나요?",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "사이드바에서 예약 작업을 열고 각 항목의 버튼을 사용하세요. 관리해도 백그라운드 실행이 켜지지는 않습니다.",
    "KovaGPT is slow or not responding.": "KovaGPT가 느리거나 응답하지 않습니다.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "한 번 다시 시도하고 새로고침한 뒤 연결을 확인하고 무거운 탭을 닫으세요. 필요하면 다시 로그인하고 방해되는 확장 프로그램을 끈 뒤 다른 브라우저나 기기를 써 보세요.",
    "A message is stuck on Thinking.": "메시지가 생각 중에서 멈췄습니다.",
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "응답을 중지하고 한 번 다시 시도한 뒤 새로고침하고 연결을 확인하세요. 더 짧은 요청이나 빠른 모드를 써 보고, 반복되면 시간과 모드를 알려 지원팀에 문의하세요.",
    "My message failed to send.": "메시지 전송에 실패했습니다.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "한 번 다시 시도하고 연결과 남은 한도를 확인한 뒤 새로고침하세요. 지원되지 않는 첨부를 빼고 다시 로그인한 뒤 다른 브라우저를 써 보고 지원팀에 문의하세요.",
    "Search is not working.": "검색이 작동하지 않습니다.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "다시 시도하고 검색이 선택됐는지 확인한 뒤 일반적인 공개 검색을 해 보세요. 새로고침하고 연결과 한도를 확인하고 차단 기능을 끈 뒤 지원팀에 문의하세요.",
    "An image will not generate.": "이미지가 생성되지 않습니다.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "지원 설정과 정책에 맞는 프롬프트로 다시 시도하세요. 이미지 한도와 연결을 확인하고 새로고침한 뒤 다른 브라우저를 써 보고 지원팀에 문의하세요.",
    "Uploads keep failing.": "업로드가 계속 실패합니다.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "형식, 크기, 한도를 확인하고 파일을 하나씩 다시 올리세요. 새로고침하고 연결을 확인하고 업로드를 막는 확장 프로그램을 제거한 뒤 다른 브라우저를 써 보세요.",
    "My subscription is not showing.": "구독이 표시되지 않습니다.",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "설정 → 결제를 새로고침하고 구매한 계정인지 확인한 뒤 다시 로그인하세요. 두 번 구매하지 말고, 계속 안 보이면 영수증과 함께 지원팀에 문의하세요.",
    "The page looks broken or my sidebar disappeared.":
      "페이지가 깨지거나 사이드바가 사라졌습니다.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "새로고침하고 확대/축소를 초기화한 뒤 창을 넓히거나 모바일 탐색 버튼을 사용하세요. 페이지를 바꾸는 확장 프로그램을 끄고 다른 브라우저를 써 보세요.",
    "Why is a feature missing on another device?": "다른 기기에서 기능이 없는 이유는?",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "두 기기가 같은 계정, 요금제, 버전, 설정을 쓰는지 확인하세요. 일부 브라우저 기능과 동기화되지 않은 로컬 데이터는 기기마다 다릅니다.",
    "I see an error message. What should I send support?":
      "오류 메시지가 보입니다. 무엇을 보내야 하나요?",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "정확한 메시지, 페이지, 시간, 누른 항목, 기대한 결과, 브라우저와 기기, 보이는 상관 ID를 포함하세요. 스크린샷에서 비밀과 결제 정보는 지우세요.",
    "How do I contact support?": "지원팀에 문의하려면?",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "아래 양식이나 support@kovagpt.com을 이용하세요. 계정 이메일, 페이지, 발생한 일, 기대한 결과를 적어 주세요.",
    "How do I report a bug?": "버그를 신고하려면?",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "아래에서 버그 신고를 고르고 재현 단계, 결과, 기대 결과, 브라우저와 기기, 오류나 ID를 적어 주세요.",
    "Can I request a feature?": "기능을 요청할 수 있나요?",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "네. 지원 양식에서 기능 요청을 고르고 민감한 정보 없이 해결하고 싶은 문제를 설명하세요.",
    "What should I never send support?": "지원팀에 절대 보내면 안 되는 것은?",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "비밀번호, 일회용 코드, 패스키, 복구 코드, API 비밀 키, 카드 번호 전체는 절대 보내지 마세요.",
    "What is included in Free?": "Free에는 무엇이 포함되나요?",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "매우 제한된 사용량으로 KovaGPT를 체험하세요. Argon Lite와 Medium(생각 중). 프로젝트로 채팅 정리, 라이브러리에서 파일과 이미지 찾기. 채팅 사용량 매우 제한, 모든 모델에 한도 적용. 이미지 생성과 업로드 제한. 클라우드 저장 공간 포함. 공급자가 가능할 때 검색과 이미지 생성. 활성화 시 기본 메모리.",
    "What is included in Plus?": "Plus에는 무엇이 포함되나요?",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "Max까지 일곱 모델(Lite, Medium, High, Extra High, Max)로 사용량 확대. 모든 모델에 한도 적용. 프로젝트로 채팅 정리, 라이브러리에서 파일과 이미지 찾기. 이미지 생성과 업로드 확대. 클라우드 저장 공간 포함. 공급자가 가능할 때 검색과 이미지 생성. 활성화 시 향상된 메모리.",
    "What is included in Pro?": "Pro에는 무엇이 포함되나요?",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "Ultra까지 일곱 모델(Lite, Medium, High, Extra High, Max, Ultra)로 가장 많은 사용량. 모든 모델에 한도 적용. 프로젝트로 채팅 정리, 라이브러리에서 파일과 이미지 찾기. 이미지 생성과 업로드 확대. 클라우드 저장 공간 포함. 공급자가 가능할 때 검색과 이미지 생성. 활성화 시 확장 메모리.",
    "Getting started": "시작하기",
    "Account & sign-in": "계정 및 로그인",
    "Chat & modes": "채팅 및 모드",
    "Search & research": "검색 및 조사",
    "Files & images": "파일 및 이미지",
    "Library & sharing": "라이브러리 및 공유",
    "Apps & integrations": "앱 및 연동",
    "Local places": "지역 장소",
    "Settings & memory": "설정 및 메모리",
    "Billing & plans": "결제 및 요금제",
    "Privacy & security": "개인정보 및 보안",
    Troubleshooting: "문제 해결",
    "Contact & support": "문의 및 지원",
    "Help categories": "도움말 카테고리",
    Back: "뒤로",
    "KovaGPT Help Center": "KovaGPT 고객센터",
    "How can we help?": "무엇을 도와드릴까요?",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "답변을 검색하거나 자주 찾는 주제를 보거나 KovaGPT 지원팀에 문의하세요.",
    "Search help…": "도움말 검색…",
    "Search help": "도움말 검색",
    "Try a different search or send us a message below.":
      "다른 검색어를 쓰거나 아래에서 메시지를 보내 주세요.",
    "Show more answers": "답변 더 보기",
    "Find a fix for your setup": "내 환경에 맞는 해결책 찾기",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "문제, 브라우저, 연결, 요금제, 시작 시점을 고르면 구체적인 단계를 보여 드립니다. 도움말과 설정 점검을 조합한 것이며 모든 문제의 보고서는 아닙니다.",
    "Your issue": "문제",
    "Help issue": "문제",
    "Browser & device": "브라우저 및 기기",
    "Help browser": "브라우저",
    Connection: "연결",
    "Help connection": "연결",
    "Kova plan": "Kova 요금제",
    "Help plan": "요금제",
    "When it started": "시작 시점",
    "Help stage": "시점",
    "Troubleshooting steps": "문제 해결 단계",
    "Loading support form…": "지원 양식 불러오는 중…",
    "Request accepted": "요청 접수됨",
    "Send another message": "다른 메시지 보내기",
    "Still need help?": "아직 도움이 필요하신가요?",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "원하는 답을 찾지 못했나요? KovaGPT 지원팀에 메시지를 보내면 이메일로 답해 드립니다.",
    Optional: "선택 사항",
    Topic: "주제",
    "Choose a topic": "주제 선택",
    "Tell us what happened, what you expected, and any error message you saw.":
      "무슨 일이 있었는지, 무엇을 기대했는지, 본 오류 메시지를 알려주세요.",
    "We’ll use your email only to respond to this support request.":
      "이메일은 이 문의에 답하는 데만 사용합니다.",
    "Sending…": "보내는 중…",
    "Support request status": "문의 상태",
    "Your message is still here.": "메시지는 그대로 있습니다.",
    Features: "기능",
    Learn: "알아보기",
    Business: "비즈니스",
    Pricing: "요금",
    Review: "리뷰",
    "Open KovaGPT": "KovaGPT 열기",
    "Open app": "앱 열기",
    "All projects": "모든 프로젝트",
    "My projects": "내 프로젝트",
    "Shared with me": "나와 공유됨",
    "Browse answers": "답변 둘러보기",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      "'구독 취소', '로그인 안 됨', '느림', 'Google 메일' 등을 검색해 보세요.",
  },
  ar: {
    "Why is Thinking blue?": 'لماذا يظهر "يفكر" باللون الأزرق؟',
    "The brain and Thinking label turn blue when deeper reasoning is on. Click the same button again for Default. Free has this simple on/off control; Plus and Pro have additional model levels.":
      'يتحول الدماغ وتسمية "يفكر" إلى الأزرق عند تفعيل التفكير العميق. انقر الزر نفسه مرة أخرى للعودة إلى الافتراضي. يوفر Free مفتاح تشغيل/إيقاف بسيطًا، بينما يوفر Plus وPro مستويات نماذج إضافية.',
    "How do I resize or color the sidebar?": "كيف أغيّر حجم الشريط الجانبي أو لونه؟",
    "On a desktop, drag the sidebar's right edge. You can also focus that edge and press Left or Right; Home and End use its minimum and maximum widths. Open More → Customize sidebar to choose items, color, search placement, and recent-chat visibility. Choices are saved for this account in this browser.":
      "على الحاسوب، اسحب الحافة اليمنى للشريط الجانبي. يمكنك أيضًا التركيز عليها والضغط على السهم الأيسر أو الأيمن؛ ويطبق Home وEnd الحد الأدنى والأقصى للعرض. افتح المزيد ← تخصيص الشريط الجانبي لاختيار العناصر واللون وموضع البحث وإظهار المحادثات الأخيرة. تُحفظ الاختيارات لهذا الحساب في هذا المتصفح.",
    "How do I copy or remove a chat link?": "كيف أنسخ رابط محادثة أو أزيله؟",
    "Choose Share in a saved chat to copy its public link. Anyone with the link can read that snapshot for 30 days. Files and future messages are excluded. Revoke a link under Settings → Data controls. A success popup appears only after the clipboard accepts the link.":
      "اختر مشاركة في محادثة محفوظة لنسخ رابطها العام. يمكن لأي شخص لديه الرابط قراءة اللقطة لمدة 30 يومًا، دون الملفات أو الرسائل اللاحقة. ألغِ الروابط من الإعدادات ← عناصر التحكم في البيانات. تظهر رسالة النجاح فقط بعد أن تقبل الحافظة الرابط.",
    "The clipboard won't copy a share link.": "الحافظة لا تنسخ رابط المشاركة.",
    "If clipboard access fails, the link appears in a dialog. Select the link to copy it manually or choose Copy link to retry.":
      "إذا فشل الوصول إلى الحافظة، يظهر الرابط في نافذة. حدّده لنسخه يدويًا أو اختر نسخ الرابط لإعادة المحاولة.",
    "Which image shapes and custom sizes can I use?": "ما أشكال الصور والأحجام المخصصة المتاحة؟",
    "Choose Square 1:1, Landscape 3:2, Portrait 2:3, Widescreen 16:9, Story 9:16, or Custom with a supported image model. Custom edges must be multiples of 16, no more than 3840 pixels, with 655,360–8,294,400 total pixels and a ratio from 1:3 to 3:1. Larger outputs may take longer.":
      "اختر مربع 1:1 أو أفقي 3:2 أو عمودي 2:3 أو عريض 16:9 أو قصة 9:16 أو مخصص مع نموذج مدعوم. يجب أن تكون الحواف المخصصة من مضاعفات 16 وألا تتجاوز 3840 بكسل، بإجمالي 655,360–8,294,400 بكسل ونسبة من 1:3 إلى 3:1. قد تستغرق الصور الأكبر وقتًا أطول.",
    "How do I create an image in a normal chat?": "كيف أنشئ صورة في محادثة عادية؟",
    "Open the + menu and choose Create Image, then describe what you want and send the message. Sign-in and an available image allowance are required. The output stays in that conversation and can be saved to Library.":
      "افتح قائمة + واختر إنشاء صورة، ثم صف ما تريد وأرسل الرسالة. يلزم تسجيل الدخول ورصيد صور متاح. تبقى النتيجة في المحادثة ويمكن حفظها في المكتبة.",
    "Why doesn't the activity panel show Cloud browser?":
      "لماذا لا تعرض لوحة النشاط المتصفح السحابي؟",
    "The panel displays recorded sources and outputs from this conversation. Browser preview and tab count appear when a browser integration supplies real active-session data. Web search alone does not mean a cloud browser is active.":
      "تعرض اللوحة المصادر والمخرجات المسجلة لهذه المحادثة. تظهر معاينة المتصفح وعدد علامات التبويب عندما يوفر تكامل المتصفح بيانات جلسة فعلية. البحث على الويب وحده لا يعني أن المتصفح السحابي نشط.",
    "How much usage does each plan include?": "ما مقدار الاستخدام في كل خطة؟",
    "Free has very limited usage. Plus costs $16 per month and offers expanded dynamic chat usage. Pro costs $80 per month and offers our highest dynamic chat allowance. Usage varies with the model and task, and limits apply to every chat model.":
      "استخدام Free محدود جدًا. يكلف Plus ‏16 دولارًا شهريًا ويقدم استخدامًا موسعًا، ويكلف Pro ‏80 دولارًا شهريًا ويقدم أعلى حصة لدينا. يختلف الاستخدام حسب النموذج والمهمة، وتنطبق الحدود على كل النماذج.",
    "Scheduled tasks says access could not be verified.":
      "تقول المهام المجدولة إنه تعذّر التحقق من الوصول.",
    "Reload once and confirm the same verified account is signed in. If it persists, Support must check the deployment's task schema and account-access functions. A client refresh cannot repair a missing database migration. Existing task records should not be deleted as a workaround.":
      "أعد التحميل مرة واحدة وتأكد من تسجيل الدخول بالحساب الموثّق نفسه. إذا استمرت المشكلة، يجب على الدعم فحص مخطط المهام ووظائف الوصول. لا يُصلح التحديث ترحيل قاعدة بيانات ناقصًا. لا تحذف المهام كحل بديل.",
    "My task is saved but background execution isn't ready.":
      "مهمتي محفوظة لكن التنفيذ في الخلفية غير جاهز.",
    "Check the task's status and time zone. Scheduled execution requires a configured provider, approved runtime policy, and a healthy scheduler heartbeat. If the page reports a service problem, keep the task and contact Support; repeated Run actions can create unwanted duplicate work.":
      "تحقق من حالة المهمة ومنطقتها الزمنية. يتطلب التنفيذ المجدول مزودًا مُعدًّا وسياسة معتمدة ومجدولًا سليمًا. إذا أبلغت الصفحة عن مشكلة في الخدمة، فاحتفظ بالمهمة وتواصل مع الدعم؛ فتكرار التشغيل قد يُنشئ عملًا مكررًا.",
    "What is KovaGPT?": "ما هو KovaGPT؟",
    "KovaGPT is an AI workspace for conversations, web research, supported files, images, projects, and connected apps. Availability can depend on your plan and the providers configured for this deployment.":
      "KovaGPT مساحة عمل بالذكاء الاصطناعي للمحادثات والبحث على الويب والملفات المدعومة والصور والمشاريع والتطبيقات المتصلة. يعتمد التوفر على خطتك والمزودين المُعدّين.",
    "What should I try first?": "ماذا أجرّب أولًا؟",
    "Start a new chat and ask a specific question or describe an outcome you want. For ongoing work, select Projects from the sidebar so related chats, instructions, and supported files stay together.":
      "ابدأ محادثة جديدة واطرح سؤالًا محددًا أو صف النتيجة التي تريدها. للأعمال المستمرة، اختر المشاريع من الشريط الجانبي لتبقى المحادثات والتعليمات والملفات معًا.",
    "How do I start a new chat?": "كيف أبدأ محادثة جديدة؟",
    "Select New chat in the sidebar. Choose a mode or tool in the composer, enter your message, and send it.":
      "اختر محادثة جديدة في الشريط الجانبي، ثم اختر وضعًا أو أداة واكتب رسالتك وأرسلها.",
    "Where are my previous chats?": "أين محادثاتي السابقة؟",
    "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.":
      "تتزامن المحادثات العادية مع حسابك عند توفر المزامنة. تبقى التعديلات دون اتصال على هذا الجهاز حتى تأكيدها، ولا تُحفظ المحادثة المؤقتة في السجل.",
    "Can I use KovaGPT without an account?": "هل يمكنني استخدام KovaGPT دون حساب؟",
    "A verified account is required to chat, create or edit images, manage Library files, and use KovaGPT tools. Choose Log in or Create an account. Help, pricing, legal information, and read-only shared links are public.":
      "يلزم حساب موثّق للمحادثة وإنشاء الصور أو تعديلها وإدارة المكتبة واستخدام الأدوات. اختر تسجيل الدخول أو إنشاء حساب. المساعدة والأسعار والمعلومات القانونية والروابط المشتركة للقراءة فقط متاحة للجميع.",
    "Does KovaGPT work on mobile?": "هل يعمل KovaGPT على الجوال؟",
    "Yes. KovaGPT has a responsive web experience and can be installed as a web app where the browser supports installation.":
      "نعم. يتكيف KovaGPT مع الشاشة ويمكن تثبيته كتطبيق ويب في المتصفحات التي تدعم ذلك.",
    "Which browsers are supported?": "ما المتصفحات المدعومة؟",
    "Use a current version of a modern browser. If a device feature such as passkeys, installation, or push notifications is missing, update the browser or try another current browser.":
      "استخدم إصدارًا حديثًا من متصفح حديث. إذا كانت ميزة مثل مفاتيح المرور أو التثبيت أو الإشعارات غير متاحة، فحدّث المتصفح أو جرّب متصفحًا آخر.",
    "How do I create an account?": "كيف أنشئ حسابًا؟",
    "Choose Sign in, then continue with an available provider or email. The sign-in screen shows only the methods enabled for the current deployment.":
      "اختر تسجيل الدخول ثم تابع بمزود متاح أو بالبريد الإلكتروني. تعرض الشاشة الطرق المفعّلة فقط.",
    "How do I change my display name or profile image?": "كيف أغيّر اسمي المعروض أو صورة ملفي؟",
    "Open your profile menu → Settings → Account. Update the fields available for your account; provider-managed profile details may need to be changed with that provider.":
      "افتح قائمة الملف الشخصي ← الإعدادات ← الحساب وحدّث الحقول المتاحة. قد تحتاج التفاصيل التي يديرها مزود إلى تغييرها لديه.",
    "How do I change my password?": "كيف أغيّر كلمة المرور؟",
    "Choose Forgot password on the email sign-in screen. Accounts created with Google or another external provider manage their password with that provider.":
      "اختر نسيت كلمة المرور في شاشة الدخول بالبريد. الحسابات المنشأة عبر Google أو مزود آخر تُدار كلمات مرورها لدى ذلك المزود.",
    "How does Google sign-in work?": "كيف يعمل تسجيل الدخول عبر Google؟",
    "Choose Continue with Google and approve the Google sign-in request. KovaGPT does not receive your Google password.":
      "اختر المتابعة باستخدام Google ووافق على الطلب. لا يتلقى KovaGPT كلمة مرور Google الخاصة بك.",
    "Why did Google sign-in fail?": "لماذا فشل تسجيل الدخول عبر Google؟",
    "Retry, refresh the page, allow the sign-in window, and confirm cookies are not blocked. Then try another current browser; contact support if the problem continues.":
      "أعد المحاولة وحدّث الصفحة واسمح بنافذة تسجيل الدخول وتأكد من عدم حظر ملفات تعريف الارتباط. ثم جرّب متصفحًا آخر وتواصل مع الدعم إذا استمرت المشكلة.",
    "I cannot sign in. What should I try?": "لا أستطيع تسجيل الدخول. ماذا أجرّب؟",
    "Retry once, refresh, verify your connection, and request a fresh sign-in or password-reset email. Check browser privacy blockers, then try another current browser or device before contacting support.":
      "أعد المحاولة مرة وحدّث الصفحة وتحقق من اتصالك واطلب رسالة دخول أو إعادة تعيين جديدة. افحص أدوات حظر الخصوصية وجرّب متصفحًا أو جهازًا آخر قبل التواصل مع الدعم.",
    "Why did my sign-in email not arrive?": "لماذا لم تصل رسالة تسجيل الدخول؟",
    "Check spam, junk, and Promotions, confirm the address, and request a fresh email. Use only the newest link because older or expired links may not work.":
      "افحص البريد العشوائي والترويجي وتأكد من العنوان واطلب رسالة جديدة. استخدم أحدث رابط فقط لأن الروابط القديمة قد لا تعمل.",
    "Does KovaGPT support passkeys?": "هل يدعم KovaGPT مفاتيح المرور؟",
    "Passkey sign-in is available when enabled for the deployment and supported by your browser and device. Manage registered passkeys in Settings.":
      "يتوفر الدخول بمفتاح المرور عند تفعيله ودعمه من متصفحك وجهازك. أدِر مفاتيحك من الإعدادات.",
    "How do I send a message?": "كيف أرسل رسالة؟",
    "Type in the composer and select Send, or use the keyboard shortcut shown by your device. Attach supported context before sending if needed.":
      "اكتب في مربع الرسالة واختر إرسال أو استخدم اختصار لوحة المفاتيح. أرفق السياق قبل الإرسال عند الحاجة.",
    "How do I stop a response?": "كيف أوقف ردًا؟",
    "Use the stop control that replaces Send while a response is being generated. Stopping keeps the content already received.":
      "استخدم زر الإيقاف الذي يحل محل إرسال أثناء إنشاء الرد. يُحتفظ بالمحتوى المستلم.",
    "Can I regenerate an answer?": "هل يمكنني إعادة إنشاء الإجابة؟",
    "Use the retry action on a completed or failed response when it is shown. A new result may differ, so verify important details.":
      "استخدم إعادة المحاولة على الرد المكتمل أو الفاشل عند ظهورها. قد تختلف النتيجة الجديدة، فتحقق من التفاصيل المهمة.",
    "Can I edit a previous message?": "هل يمكنني تعديل رسالة سابقة؟",
    "Use the edit action when it appears on your message. Editing creates a new path from that point, so later context can change.":
      "استخدم تعديل عند ظهوره على رسالتك. يُنشئ التعديل مسارًا جديدًا من تلك النقطة وقد يتغير السياق اللاحق.",
    "How do I copy an answer?": "كيف أنسخ إجابة؟",
    "Use the copy action on the response. For generated artifacts, use the editor or export controls offered for that item.":
      "استخدم نسخ على الرد. وللعناصر المُنشأة استخدم المحرر أو أدوات التصدير.",
    "How do I rename or delete a conversation?": "كيف أعيد تسمية محادثة أو أحذفها؟",
    "Open the conversation menu in history and choose Rename or Delete. Confirm deletion carefully because deleted conversations may not be recoverable.":
      "افتح قائمة المحادثة في السجل واختر إعادة تسمية أو حذف. أكّد الحذف بعناية لأنه قد لا يمكن استرداده.",
    "Why can KovaGPT make mistakes?": "لماذا قد يخطئ KovaGPT؟",
    "AI responses can be incomplete or incorrect. Check important claims, calculations, and cited sources, especially for medical, legal, financial, or safety-sensitive decisions.":
      "قد تكون ردود الذكاء الاصطناعي ناقصة أو خاطئة. تحقق من الادعاءات والحسابات والمصادر المهمة، خاصة في القرارات الطبية أو القانونية أو المالية أو المتعلقة بالسلامة.",
    "Does a new chat remember an earlier chat?": "هل تتذكر المحادثة الجديدة محادثة سابقة؟",
    "Only Adaptive Memory can carry selected context across ordinary chats, and it is available to signed-in Plus and Pro users when enabled. A new chat otherwise starts with its own context.":
      "الذاكرة التكيفية وحدها تنقل سياقًا مختارًا بين المحادثات العادية، وهي متاحة لمستخدمي Plus وPro المسجّلين عند تفعيلها. وإلا تبدأ كل محادثة بسياقها الخاص.",
    "Why did a long conversation lose context?": "لماذا فقدت محادثة طويلة سياقها؟",
    "Very long conversations can exceed the context available to the selected model. Restate the important details, attach a concise source, or start a new chat with a summary.":
      "قد تتجاوز المحادثات الطويلة جدًا السياق المتاح للنموذج. أعد ذكر التفاصيل المهمة أو أرفق مصدرًا موجزًا أو ابدأ محادثة جديدة بملخص.",
    "What is Lite mode?": "ما وضع Lite؟",
    "Default is the fastest Chat setting. Free users turn the brain-shaped Thinking button on for deeper reasoning, or off for Default. Plus adds Medium and High; Pro adds Extra High, Max, and Ultra. An account is required.":
      'الوضع الافتراضي هو الأسرع. في Free يشغّل زر "يفكر" على شكل دماغ التفكير الأعمق أو يعيد إلى الافتراضي. يضيف Plus المتوسط والعالي، ويضيف Pro العالي جدًا والأقصى وUltra. يلزم وجود حساب.',
    "What is Medium mode?": "ما الوضع المتوسط؟",
    "Medium gives the same Chat model more working time than Lite. It is available on Plus and Pro.":
      "يمنح المتوسط النموذج نفسه وقت عمل أطول من Lite، وهو متاح في Plus وPro.",
    "What is Thinking mode?": "ما وضع التفكير؟",
    "Thinking is the Plus label for the higher-effort Chat route. It uses the same underlying Chat model with more working time than Medium.":
      "التفكير هو اسم وضع الجهد الأعلى في Plus، ويستخدم النموذج نفسه بوقت أطول من المتوسط.",
    "What is High mode?": "ما الوضع العالي؟",
    "High is the Pro label for that higher-effort Chat route. It is available on Pro.":
      "العالي هو اسم وضع الجهد الأعلى في Pro، وهو متاح في Pro.",
    "What is Extra High mode?": "ما الوضع العالي جدًا؟",
    "Extra High gives the same Chat model additional bounded analysis, checking, and revision time. It is available on Pro.":
      "يمنح العالي جدًا النموذج نفسه وقتًا إضافيًا محدودًا للتحليل والتحقق والمراجعة، وهو متاح في Pro.",
    "What is Max mode?": "ما الوضع الأقصى؟",
    "Max uses a larger bounded work budget on the same Chat model for difficult requests. It is available on Pro.":
      "يستخدم الأقصى ميزانية عمل أكبر مع النموذج نفسه للطلبات الصعبة، وهو متاح في Pro.",
    "What is Ultra mode?": "ما وضع Ultra؟",
    "Ultra is the deepest Pro Chat effort and can use bounded sub-agent orchestration over the same underlying Chat model.":
      "Ultra هو أعمق مستوى في Pro ويمكنه تنسيق وكلاء فرعيين محدودين على النموذج نفسه.",
    "Which modes are on each plan?": "ما الأوضاع في كل خطة؟",
    "Free includes Lite, Medium. Plus includes Lite, Medium, High, Extra High, Max. Pro includes Lite, Medium, High, Extra High, Max, Ultra. Previous Kova generations also remain available for consistency with older work.":
      "يتضمن Free وضعي Lite والمتوسط، ويتضمن Plus ‏Lite والمتوسط والعالي والعالي جدًا والأقصى، ويتضمن Pro كل ذلك مع Ultra. تبقى الأجيال السابقة من Kova متاحة للأعمال القديمة.",
    "Why do I not see every mode?": "لماذا لا أرى كل الأوضاع؟",
    "Mode availability follows your current plan and can also depend on deployment readiness. Refresh after a plan change; if Billing shows the new plan but the mode is still absent, sign out and in, then contact support.":
      "تعتمد الأوضاع على خطتك وجاهزية الخدمة. حدّث الصفحة بعد تغيير الخطة؛ وإذا ظهرت الخطة الجديدة في الفوترة دون الوضع، فسجّل الخروج والدخول ثم تواصل مع الدعم.",
    "Do more capable modes take longer?": "هل تستغرق الأوضاع الأقوى وقتًا أطول؟",
    "They can. Higher-effort modes may take longer than Lite or Medium, especially for complex requests.":
      "قد يحدث ذلك. قد تستغرق الأوضاع الأعلى جهدًا وقتًا أطول من Lite أو المتوسط، خاصة للطلبات المعقدة.",
    "What does Search do?": "ماذا يفعل البحث؟",
    "Search can retrieve current web sources when the configured search and AI providers are available. Open cited links and verify that each source supports the answer.":
      "يجلب البحث مصادر ويب حديثة عند توفر المزودين. افتح الروابط المذكورة وتحقق من أنها تدعم الإجابة.",
    "When should I use Search?": "متى أستخدم البحث؟",
    "Use Search for current events, recent product details, live public information, or whenever you want web sources. You usually do not need it for rewriting or questions based only on text you supplied.":
      "استخدمه للأحداث الجارية وتفاصيل المنتجات الحديثة والمعلومات العامة المباشرة أو متى أردت مصادر ويب. لا تحتاجه عادةً لإعادة الصياغة أو للأسئلة عن نص قدّمته.",
    "Does Search browse the live web?": "هل يتصفح البحث الويب مباشرةً؟",
    "Search can retrieve current web sources when its configured search and AI providers are available. The linked pages remain the source of truth.":
      "يمكن للبحث جلب مصادر حديثة عند توفر مزوديه. تبقى الصفحات المرتبطة هي المرجع.",
    "Can KovaGPT cite sources?": "هل يذكر KovaGPT المصادر؟",
    "Search can return linked sources. Open each citation and confirm it supports the nearby claim.":
      "يمكن للبحث إرجاع مصادر مرتبطة. افتح كل اقتباس وتأكد من أنه يدعم الادعاء المجاور.",
    "Why might two searches differ?": "لماذا قد يختلف بحثان؟",
    "Web pages and rankings change, and different wording can retrieve different evidence. Compare the citations rather than relying only on the generated summary.":
      "تتغير صفحات الويب وترتيبها، وقد تجلب صياغة مختلفة أدلة مختلفة. قارن الاقتباسات بدل الاعتماد على الملخص وحده.",
    "Why is Search unavailable?": "لماذا البحث غير متاح؟",
    "Search depends on configured providers and your remaining allowance. Refresh, confirm the tool is selected, and try again; if it remains unavailable, contact support.":
      "يعتمد البحث على المزودين ورصيدك المتبقي. حدّث الصفحة وتأكد من اختيار الأداة وأعد المحاولة؛ وإن ظل غير متاح فتواصل مع الدعم.",
    "What files can I upload to chat?": "ما الملفات التي يمكنني رفعها؟",
    "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files. Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.":
      "تقبل المحادثة النصوص والكود وCSV وJSON والصور، وتستخرج النص المقروء من ملفات PDF وDOCX وXLSX وPPTX المدعومة. تفهرس معرفة المشروع الملفات النصية المدعومة. يقتصر الاستخراج على 10 ميغابايت وقد يُسقط التنسيق أو المحتوى الممسوح أو الصفحات غير المقروءة. معاينة PDF الأصلي في المكتبة منفصلة عن النص المستخرج، ويمكن تنزيل ملفات Office الأصلية دون عرضها.",
    "How do I upload a file?": "كيف أرفع ملفًا؟",
    "Use the attachment control in the chat composer and choose a supported file. Wait for the attachment to finish preparing before sending.":
      "استخدم زر الإرفاق في مربع الرسالة واختر ملفًا مدعومًا. انتظر حتى يكتمل تجهيزه قبل الإرسال.",
    "Why did my upload fail?": "لماذا فشل الرفع؟",
    "Retry, confirm the type and size are supported, and check your connection and remaining upload allowance. Refresh and try one file at a time; if it still fails, contact support with the file type and error.":
      "أعد المحاولة وتأكد من دعم النوع والحجم وافحص اتصالك ورصيدك. حدّث الصفحة وجرّب ملفًا واحدًا في كل مرة؛ وإن استمر الفشل فتواصل مع الدعم مع نوع الملف والخطأ.",
    "Can KovaGPT analyze spreadsheets?": "هل يحلل KovaGPT جداول البيانات؟",
    "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts. It does not provide a general spreadsheet or uploaded-code execution sandbox.":
      "يستطيع KovaGPT التحليل على النصوص وCSV وJSON والصور المدعومة وعرض الجداول أو المخططات، لكنه لا يوفر بيئة عامة لتشغيل جداول البيانات أو الكود المرفوع.",
    "Can KovaGPT understand uploaded images?": "هل يفهم KovaGPT الصور المرفوعة؟",
    "Chat accepts supported image attachments and can reason about their visible content. Results may miss small text or ambiguous details, so verify against the original.":
      "تقبل المحادثة الصور المدعومة وتحلل محتواها المرئي. قد تفوتها نصوص صغيرة أو تفاصيل غامضة، فتحقق من الأصل.",
    "Are file limits different by plan?": "هل تختلف حدود الملفات حسب الخطة؟",
    "Yes. Published upload and storage allowances increase by plan. Check Pricing and the usage information shown in the product for the current allowance.":
      "نعم. تزداد حصص الرفع والتخزين حسب الخطة. راجع الأسعار ومعلومات الاستخدام في المنتج.",
    "Can I remove a file before sending?": "هل يمكنني إزالة ملف قبل الإرسال؟",
    "Yes. Use the remove control on the attachment preview before sending the message.":
      "نعم. استخدم زر الإزالة في معاينة المرفق قبل الإرسال.",
    "How do I generate an image?": "كيف أنشئ صورة؟",
    "Open Images, describe the subject, composition, and style, choose available settings, and generate. You must be signed in and have image allowance remaining.":
      "افتح الصور وصف الموضوع والتكوين والأسلوب واختر الإعدادات ثم أنشئ الصورة. يلزم تسجيل الدخول ورصيد صور متاح.",
    "How should I describe the image I want?": "كيف أصف الصورة التي أريدها؟",
    "State the subject, setting, composition, lighting, medium, and important exclusions. Clear constraints usually work better than a long list of vague adjectives.":
      "اذكر الموضوع والمكان والتكوين والإضاءة والأسلوب والاستثناءات المهمة. القيود الواضحة أفضل عادةً من قائمة صفات مبهمة.",
    "Can I edit an existing image?": "هل يمكنني تعديل صورة موجودة؟",
    "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.":
      "عدّل صورة من المكتبة باستخدام نموذج مدعوم. يمكن لقناع PNG شفاف اختياري توجيه التغيير. تنطبق حصص الصور.",
    "Why was an image request rejected?": "لماذا رُفض طلب الصورة؟",
    "A request can be rejected by safety rules, invalid settings, an unsupported source image, or provider availability. Revise the request without prohibited content and use supported settings.":
      "قد يُرفض الطلب بسبب قواعد السلامة أو إعدادات غير صالحة أو صورة مصدر غير مدعومة أو عدم توفر المزود. عدّل الطلب دون محتوى محظور واستخدم إعدادات مدعومة.",
    "Why is image generation slow?": "لماذا إنشاء الصور بطيء؟",
    "Generation time varies with provider load and selected settings. Keep the page open, retry only after an error, and avoid starting duplicate requests.":
      "يختلف وقت الإنشاء حسب ضغط المزود والإعدادات. أبقِ الصفحة مفتوحة وأعد المحاولة بعد الخطأ فقط وتجنب الطلبات المكررة.",
    "Are image limits plan dependent?": "هل تعتمد حدود الصور على الخطة؟",
    "Yes. Every plan has a finite daily image allowance, with higher published allowances on paid plans.":
      "نعم. لكل خطة حصة يومية من الصور، وهي أعلى في الخطط المدفوعة.",
    "What is Canvas?": "ما هي اللوحة (Canvas)؟",
    "Generated writing, code, and website artifacts can open in an editor with export and session-only versions. Versions are not durable after the editor closes.":
      "يمكن فتح النصوص والأكواد والمواقع المُنشأة في محرر مع التصدير وإصدارات الجلسة. لا تُحفظ الإصدارات بعد إغلاق المحرر.",
    "What are Projects?": "ما هي المشاريع؟",
    "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.":
      "تنظّم المشاريع المحادثات والملفات والصور والملاحظات والمهام وذاكرة المشروع والتعليمات.",
    "How do I create a project?": "كيف أنشئ مشروعًا؟",
    "Select Projects from the sidebar, choose New project, enter the requested details, and create it.":
      "اختر المشاريع من الشريط الجانبي ثم مشروع جديد، وأدخل التفاصيل وأنشئه.",
    "How do I rename a project?": "كيف أعيد تسمية مشروع؟",
    "Open the project and use its settings or project menu to update the name.":
      "افتح المشروع واستخدم إعداداته أو قائمته لتحديث الاسم.",
    "How do I delete a project?": "كيف أحذف مشروعًا؟",
    "Open the project settings, choose Delete project, and confirm. Deletion also cleans up project-owned records and stored project files, so review the confirmation carefully.":
      "افتح إعدادات المشروع واختر حذف المشروع ثم أكّد. يُحذف أيضًا سجل المشروع وملفاته، فراجع التأكيد بعناية.",
    "How do I add chats to a project?": "كيف أضيف محادثات إلى مشروع؟",
    "Start a chat from inside the project. Where a move control is offered, you can also assign an existing eligible chat to a project.":
      "ابدأ محادثة من داخل المشروع. وحيث يتوفر خيار النقل يمكنك إضافة محادثة موجودة أيضًا.",
    "Can I upload files to a project?": "هل يمكنني رفع ملفات إلى مشروع؟",
    "Yes. Project knowledge accepts supported files, subject to your upload and storage allowances.":
      "نعم. تقبل معرفة المشروع الملفات المدعومة ضمن حصص الرفع والتخزين.",
    "Does project context carry across chats?": "هل ينتقل سياق المشروع بين المحادثات؟",
    "Project instructions, supported knowledge, notes, and project memory can provide context to chats in that project. Keep critical instructions explicit and verify important outputs.":
      "يمكن لتعليمات المشروع ومعرفته وملاحظاته وذاكرته أن توفر سياقًا لمحادثاته. اجعل التعليمات المهمة صريحة وتحقق من النتائج المهمة.",
    "Can I share a project?": "هل يمكنني مشاركة مشروع؟",
    "Project owners can open the Members area and invite collaborators. Sharing requires the collaboration service to be available.":
      "يمكن لمالكي المشاريع فتح الأعضاء ودعوة متعاونين، بشرط توفر خدمة التعاون.",
    "How do project invitations work?": "كيف تعمل دعوات المشاريع؟",
    "The owner sends an invitation to an email address. The recipient signs in with the invited identity and accepts the invitation before accessing the project.":
      "يرسل المالك دعوة إلى بريد إلكتروني، ثم يسجّل المستلم الدخول بالهوية المدعوّة ويقبل الدعوة قبل الوصول.",
    "Can someone without an account accept a project invitation?":
      "هل يمكن لشخص دون حساب قبول دعوة؟",
    "They need a KovaGPT account associated with the invited identity before they can participate.":
      "يحتاج إلى حساب KovaGPT مرتبط بالهوية المدعوّة للمشاركة.",
    "What happens when a collaborator is removed?": "ماذا يحدث عند إزالة متعاون؟",
    "Their project access is revoked. Content they previously copied or exported outside the project is not recalled.":
      "يُلغى وصوله إلى المشروع، ولا يُسترد ما نسخه أو صدّره سابقًا.",
    "Can I leave a shared project?": "هل يمكنني مغادرة مشروع مشترك؟",
    "Ask the project owner to remove your membership. The owner retains the project and its content.":
      "اطلب من المالك إزالة عضويتك، ويحتفظ هو بالمشروع ومحتواه.",
    "Who owns a shared project?": "من يملك المشروع المشترك؟",
    "The account that created the project remains its owner unless the product explicitly confirms an ownership change.":
      "يبقى الحساب الذي أنشأه مالكًا ما لم يؤكد المنتج تغيير الملكية صراحةً.",
    "What is Library?": "ما هي المكتبة؟",
    "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.":
      "تحتوي المكتبة على ما تحفظه أو ترفعه صراحةً، وليست نسخة تلقائية من كل محادثة.",
    "How do I save something to Library?": "كيف أحفظ شيئًا في المكتبة؟",
    "Use Save to Library on an eligible response, image, or file. Only items you explicitly save or upload appear there.":
      "استخدم حفظ في المكتبة على الرد أو الصورة أو الملف. يظهر فقط ما تحفظه أو ترفعه صراحةً.",
    "Can I reopen or remove a Library item?": "هل يمكنني إعادة فتح عنصر أو إزالته؟",
    "Open Library from the sidebar, select the item to reopen it, or use its delete control to remove it. Confirm deletion carefully.":
      "افتح المكتبة من الشريط الجانبي وحدد العنصر لإعادة فتحه أو استخدم الحذف لإزالته. أكّد الحذف بعناية.",
    "Can I organize Library items?": "هل يمكنني تنظيم عناصر المكتبة؟",
    "Yes. Library folders and bulk move controls are available for organizing eligible saved items.":
      "نعم. تتوفر مجلدات ونقل جماعي لتنظيم العناصر المحفوظة.",
    "How do I share a chat?": "كيف أشارك محادثة؟",
    "Use the Share action in an eligible conversation. Review the preview and access settings before creating or sending a link.":
      "استخدم مشاركة في المحادثة، وراجع المعاينة وإعدادات الوصول قبل إنشاء الرابط أو إرساله.",
    "Does a shared chat update automatically?": "هل تتحدث المحادثة المشتركة تلقائيًا؟",
    "Treat the share preview as the authority for what recipients can see. Review it again after changing the original conversation.":
      "المعاينة هي المرجع لما يراه المستلمون. راجعها مجددًا بعد تغيير المحادثة الأصلية.",
    "Which apps can I connect?": "ما التطبيقات التي يمكنني ربطها؟",
    "The working Apps page lists Google, Gmail, Google Drive, Google Calendar, GitHub. Each connection and action depends on configured credentials, granted scopes, and service availability.":
      "تتضمن صفحة التطبيقات Google وGmail وGoogle Drive وتقويم Google وGitHub. يعتمد كل اتصال على بيانات الاعتماد والأذونات الممنوحة وتوفر الخدمة.",
    "How do I connect an app?": "كيف أربط تطبيقًا؟",
    "Open Apps from the sidebar, select a provider, and review its consent screen. Approve only the permissions you understand.":
      "افتح التطبيقات من الشريط الجانبي واختر مزودًا وراجع شاشة الموافقة. وافق فقط على الأذونات التي تفهمها.",
    "How do I disconnect or reconnect an app?": "كيف أفصل تطبيقًا أو أعيد ربطه؟",
    "Open Apps, select the connected service, and choose Disconnect. To reconnect, start its connection flow again and approve the required scopes.":
      "افتح التطبيقات واختر الخدمة ثم قطع الاتصال. لإعادة الربط ابدأ عملية الاتصال مجددًا ووافق على الأذونات المطلوبة.",
    "Why does an integration ask for permission?": "لماذا يطلب التكامل أذونات؟",
    "The provider consent screen lists the scopes needed for requested actions. KovaGPT can use only the access granted and supported by the connection.":
      "تعرض شاشة الموافقة الأذونات المطلوبة، ولا يستخدم KovaGPT إلا الوصول الممنوح.",
    "What happens when I revoke access?": "ماذا يحدث عند إلغاء الوصول؟",
    "New integration actions stop working. Data already brought into a chat, project, or output is not automatically removed; delete that content separately if needed.":
      "تتوقف إجراءات التكامل الجديدة. لا تُحذف البيانات المجلوبة سابقًا تلقائيًا؛ احذفها منفصلة عند الحاجة.",
    "Why did a connected app stop working?": "لماذا توقف تطبيق متصل عن العمل؟",
    "Retry, open Apps to check connection status and scopes, then disconnect and reconnect if appropriate. Provider outages or deployment configuration can also make an action unavailable.":
      "أعد المحاولة وافحص حالة الاتصال والأذونات في التطبيقات ثم أعد الربط عند الحاجة. قد تمنع أعطال المزود أو الإعدادات الإجراء أيضًا.",
    "How does Gmail integration work?": "كيف يعمل تكامل Gmail؟",
    "Connect Gmail from Apps. Available read or write actions depend on granted scopes, configured credentials, and service availability.":
      "اربط Gmail من التطبيقات. تعتمد إجراءات القراءة أو الكتابة على الأذونات وبيانات الاعتماد وتوفر الخدمة.",
    "Can KovaGPT search my email or read attachments?":
      "هل يمكن لـ KovaGPT البحث في بريدي أو قراءة المرفقات؟",
    "It can perform only Gmail actions supported by the current connection and scopes. Review the requested action and resulting source before relying on it.":
      "يمكنه تنفيذ إجراءات Gmail التي يسمح بها الاتصال والأذونات فقط. راجع الإجراء والمصدر قبل الاعتماد عليه.",
    "Can KovaGPT draft or send email?": "هل يمكن لـ KovaGPT صياغة البريد أو إرساله؟",
    "Supported Gmail write actions require an explicit confirmation step before execution. KovaGPT does not send mail silently.":
      "تتطلب إجراءات الكتابة في Gmail تأكيدًا صريحًا قبل التنفيذ، ولا يرسل KovaGPT البريد دون علمك.",
    "Can KovaGPT check or change my calendar?": "هل يمكن لـ KovaGPT مراجعة تقويمي أو تغييره؟",
    "Connected Google Calendar actions can read or write only when supported by the granted scopes. Write actions such as creating or changing an event require confirmation before execution.":
      "يقرأ تقويم Google أو يكتب فقط ضمن الأذونات الممنوحة، ويتطلب إنشاء حدث أو تغييره تأكيدًا قبل التنفيذ.",
    "Can KovaGPT search Google Drive?": "هل يمكن لـ KovaGPT البحث في Google Drive؟",
    "Google Drive can be connected from Apps. Search and reading depend on granted scopes, supported file handling, and provider availability.":
      "يُربط Google Drive من التطبيقات. يعتمد البحث والقراءة على الأذونات والملفات المدعومة وتوفر المزود.",
    "Can KovaGPT modify Drive files?": "هل يمكن لـ KovaGPT تعديل ملفات Drive؟",
    "Do not assume general Drive editing. Only actions shown for confirmation and supported by the current connection can run.":
      "لا تفترض إمكانية التعديل العام في Drive. لا يُنفّذ إلا ما يُعرض للتأكيد ويدعمه الاتصال.",
    "How does GitHub integration work?": "كيف يعمل تكامل GitHub؟",
    "Connect GitHub from Apps and review its scopes. Available repository actions depend on the granted access and current integration support.":
      "اربط GitHub من التطبيقات وراجع أذوناته. تعتمد إجراءات المستودعات على الوصول الممنوح ودعم التكامل.",
    "What is Local places?": "ما هي الأماكن المحلية؟",
    "Local places is the planned Maps experience in KovaGPT. It remains unavailable until its provider, legal, privacy, capacity, and cost review is approved.":
      "الأماكن المحلية هي تجربة الخرائط المخططة في KovaGPT، وتبقى غير متاحة حتى اعتماد مراجعة المزود والجوانب القانونية والخصوصية والسعة والتكلفة.",
    "Can it search real places?": "هل يمكنه البحث عن أماكن حقيقية؟",
    "Not in the current release. If Maps is approved later, it can search a reviewed third-party place provider; always verify listings before traveling because they can change.":
      "ليس في الإصدار الحالي. إذا اعتُمدت الخرائط لاحقًا فيمكنها البحث لدى مزود خارجي معتمد؛ تحقق دائمًا من البيانات قبل السفر لأنها قد تتغير.",
    "Can it provide directions?": "هل يقدم الاتجاهات؟",
    "KovaGPT can open an external map handoff for directions. It does not provide its own turn-by-turn navigation.":
      "يمكن لـ KovaGPT فتح خريطة خارجية للاتجاهات، لكنه لا يوفر ملاحة خطوة بخطوة بنفسه.",
    "Does KovaGPT use my device location?": "هل يستخدم KovaGPT موقع جهازي؟",
    "Not while Maps is unavailable. If Maps is approved later, KovaGPT will request device coordinates only after you choose the explicit location control and will disclose the approved map providers that receive them. Maps does not store coordinates in Settings.":
      "ليس طالما الخرائط غير متاحة. إذا اعتُمدت لاحقًا، فلن يطلب KovaGPT الإحداثيات إلا بعد اختيارك الصريح وسيُفصح عن المزودين الذين يتلقونها. لا تحفظ الخرائط الإحداثيات في الإعدادات.",
    "Why is Local places unavailable?": "لماذا الأماكن المحلية غير متاحة؟",
    "Maps is intentionally disabled while provider, licensing, attribution, privacy, capacity, and cost approval is pending. The route does not request geolocation or call map providers in this state.":
      "الخرائط معطلة عمدًا ريثما تُعتمد جوانب المزود والترخيص والإسناد والخصوصية والسعة والتكلفة، ولا تطلب الموقع ولا تتصل بمزودي الخرائط في هذه الحالة.",
    "Where are Settings?": "أين الإعدادات؟",
    "Open your profile menu and choose Settings. Available sections include account, personalization, memory, apps, subscription, privacy, and appearance controls where applicable.":
      "افتح قائمة الملف الشخصي واختر الإعدادات، وتشمل الحساب والتخصيص والذاكرة والتطبيقات والاشتراك والخصوصية والمظهر حسب الحالة.",
    "How do I change appearance?": "كيف أغيّر المظهر؟",
    "Open your profile menu → Settings → Appearance and choose an available theme.":
      "افتح قائمة الملف الشخصي ← الإعدادات ← المظهر واختر سمة.",
    "Can I change how KovaGPT responds?": "هل يمكنني تغيير طريقة رد KovaGPT؟",
    "Use personalization controls and explicit instructions in chat or a project. KovaGPT applies supported preferences to future responses in the relevant context.":
      "استخدم أدوات التخصيص والتعليمات الصريحة في المحادثة أو المشروع، وسيطبقها KovaGPT على الردود اللاحقة.",
    "What is Adaptive Memory?": "ما الذاكرة التكيفية؟",
    "Memory is available on Free, with more capacity and context on Plus and Pro. Conversation updates are optional; saved notes can be edited or deleted. Temporary chats never use or update memory.":
      "الذاكرة متاحة في Free، مع سعة أكبر في Plus وPro. تحديثات المحادثات اختيارية ويمكن تعديل الملاحظات أو حذفها. لا تستخدم المحادثات المؤقتة الذاكرة أبدًا.",
    "How do I turn Memory off or delete it?": "كيف أوقف الذاكرة أو أحذفها؟",
    "Open Settings → Memory. Turn Memory off to block new cross-chat memory use and writes, or choose Delete saved memory to remove stored cross-chat memory.":
      "افتح الإعدادات ← الذاكرة. أوقفها لمنع استخدامها والكتابة الجديدة، أو اختر حذف الذاكرة المحفوظة.",
    "Is Memory the same as chat history?": "هل الذاكرة هي سجل المحادثات نفسه؟",
    "No. History stores eligible conversations; Adaptive Memory stores selected cross-chat context. Turning off or deleting memory does not delete chat history or local drafts.":
      "لا. يحفظ السجل المحادثات، بينما تحفظ الذاكرة التكيفية سياقًا مختارًا عبر المحادثات. إيقاف الذاكرة أو حذفها لا يحذف السجل أو المسودات.",
    "Does Temporary Chat use Memory?": "هل تستخدم المحادثة المؤقتة الذاكرة؟",
    "No. Temporary Chat does not use or update Adaptive Memory and stays out of conversation history.":
      "لا. لا تستخدم المحادثة المؤقتة الذاكرة ولا تحدّثها ولا تظهر في السجل.",
    "How do notifications work?": "كيف تعمل الإشعارات؟",
    "Open Notifications to review in-product notifications. Web push requires a supported browser, permission, and deployment configuration.":
      "افتح الإشعارات لمراجعتها. تتطلب إشعارات الدفع متصفحًا مدعومًا وإذنًا وإعدادًا مناسبًا.",
    "What plans does KovaGPT offer?": "ما الخطط التي يقدمها KovaGPT؟",
    "KovaGPT offers Free, Plus, and Pro. Enterprise requirements can be discussed separately; scope and terms are confirmed before purchase.":
      "يقدم KovaGPT خطط Free وPlus وPro. تُناقش متطلبات المؤسسات بشكل منفصل، ويُؤكد النطاق والشروط قبل الشراء.",
    "How much do Plus and Pro cost?": "كم تكلفة Plus وPro؟",
    "Published monthly prices are $16 USD for Plus and $80 USD for Pro before any tax shown at checkout. Confirm the final amount in Stripe before purchase.":
      "الأسعار الشهرية 16 دولارًا لـ Plus و80 دولارًا لـ Pro قبل الضرائب. تأكد من المبلغ النهائي في Stripe قبل الشراء.",
    "How does the first-month discount work?": "كيف يعمل خصم الشهر الأول؟",
    "Eligible accounts receive 50% off the first paid month of a Plus or Pro monthly subscription, once per account. Later months use the regular published monthly price. New subscriptions do not receive a free trial; existing trials keep their original terms. Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.":
      "تحصل الحسابات المؤهلة على خصم 50% على أول شهر مدفوع من اشتراك Plus أو Pro الشهري مرة واحدة لكل حساب، ثم يُطبق السعر العادي. لا تتضمن الاشتراكات الجديدة تجربة مجانية، وتحتفظ التجارب الحالية بشروطها. يؤكد Stripe الأهلية والدفعة الأولى ومبلغ التجديد قبل الاشتراك.",
    "How do I upgrade or downgrade?": "كيف أرقّي خطتي أو أخفّضها؟",
    "Open Settings → Billing. Choose an available plan change and review its price and effective date in checkout or the billing portal before confirming.":
      "افتح الإعدادات ← الفوترة واختر التغيير وراجع السعر وتاريخ السريان قبل التأكيد.",
    "Where do I manage my subscription?": "أين أدير اشتراكي؟",
    "Open Settings → Billing and choose Manage subscription. If the Stripe portal is not configured, use the displayed support option.":
      "افتح الإعدادات ← الفوترة واختر إدارة الاشتراك. إن لم تتوفر بوابة Stripe فاستخدم خيار الدعم.",
    "What payment methods are accepted?": "ما طرق الدفع المقبولة؟",
    "Stripe Checkout shows the payment methods available for your account, device, and region. KovaGPT does not promise that every method is available everywhere.":
      "تعرض صفحة Stripe طرق الدفع المتاحة لحسابك وجهازك ومنطقتك، ولا تتوفر كل الطرق في كل مكان.",
    "Why did my payment fail?": "لماذا فشل الدفع؟",
    "Confirm the billing details, available funds, and any bank authentication request, then retry once. Contact your bank or support if Stripe continues to reject the payment.":
      "تحقق من بيانات الفوترة والرصيد وأي تحقق مصرفي، ثم أعد المحاولة مرة. إن استمر الرفض فتواصل مع البنك أو الدعم.",
    "Where are invoices and receipts?": "أين الفواتير والإيصالات؟",
    "Open Settings → Billing → Manage subscription to view billing records available in Stripe. If the portal is unavailable, contact support from your account email.":
      "افتح الإعدادات ← الفوترة ← إدارة الاشتراك لعرض السجلات في Stripe. إن لم تتوفر البوابة فراسل الدعم من بريد حسابك.",
    "Why was tax added?": "لماذا أُضيفت ضريبة؟",
    "Stripe calculates applicable tax from the billing information and rules presented at checkout. The published plan prices are before any tax shown there.":
      "يحسب Stripe الضريبة المطبقة من بيانات الفوترة والقواعد المعروضة، والأسعار المعلنة قبل الضريبة.",
    "How do I update my payment method?": "كيف أحدّث طريقة الدفع؟",
    "Open Settings → Billing → Manage subscription and use the Stripe portal. If that control is unavailable, contact support.":
      "افتح الإعدادات ← الفوترة ← إدارة الاشتراك واستخدم بوابة Stripe، وإلا فتواصل مع الدعم.",
    "Does my subscription renew automatically?": "هل يتجدد اشتراكي تلقائيًا؟",
    "Review the checkout and Stripe portal for the renewal date and terms that apply to your subscription.":
      "راجع صفحة الدفع وبوابة Stripe لمعرفة تاريخ التجديد وشروطه.",
    "How do I cancel?": "كيف ألغي؟",
    "Open Settings → Billing → Manage subscription and cancel in the Stripe portal. If self-service cancellation is unavailable, contact support from your account email.":
      "افتح الإعدادات ← الفوترة ← إدارة الاشتراك وألغِ من بوابة Stripe، وإلا فراسل الدعم من بريد حسابك.",
    "What happens after cancellation?": "ماذا يحدث بعد الإلغاء؟",
    "The Stripe portal confirms the effective date. Your chats are not deleted merely because a paid subscription ends, but paid features and higher allowances stop when the plan changes.":
      "تؤكد بوابة Stripe تاريخ السريان. لا تُحذف محادثاتك بانتهاء الاشتراك، لكن الميزات المدفوعة والحصص الأعلى تتوقف عند تغيير الخطة.",
    "Are refunds available?": "هل الاسترداد متاح؟",
    "Review the current Refund Policy for eligibility, then contact support with your account email and purchase details. Do not include a full card number.":
      "راجع سياسة الاسترداد ثم تواصل مع الدعم ببريد حسابك وتفاصيل الشراء. لا تُدرج رقم البطاقة كاملًا.",
    "Why is my upgraded plan not showing?": "لماذا لا تظهر خطتي المرقّاة؟",
    "Refresh Billing, confirm the purchase completed for the same account, then sign out and in. Do not buy again while a payment is reconciling; contact support if the mismatch remains.":
      "حدّث الفوترة وتأكد من إتمام الشراء للحساب نفسه ثم سجّل الخروج والدخول. لا تشترِ مجددًا أثناء معالجة الدفع، وتواصل مع الدعم إن استمر الاختلاف.",
    "How do usage limits work?": "كيف تعمل حدود الاستخدام؟",
    "Free usage is very limited. Plus has expanded dynamic chat usage, and Pro has our highest allowance. Usage varies with the model and task. All chat models have limits; check Usage for your next refresh.":
      "استخدام Free محدود جدًا، ويوسّعه Plus، ويقدم Pro أعلى حصة. يختلف الاستخدام حسب النموذج والمهمة، ولكل النماذج حدود؛ راجع الاستخدام لمعرفة موعد التجديد.",
    "How does KovaGPT use my data?": "كيف يستخدم KovaGPT بياناتي؟",
    "Review the current Privacy Policy for the authoritative description of collection, processing, providers, retention, and your choices.":
      "راجع سياسة الخصوصية الحالية للاطلاع على الجمع والمعالجة والمزودين والاحتفاظ وخياراتك.",
    "Are my conversations private?": "هل محادثاتي خاصة؟",
    "Chats are tied to your account or device according to the active mode and sync state. Do not put secrets into a chat, and review the Privacy Policy and sharing preview before sending content.":
      "ترتبط المحادثات بحسابك أو جهازك حسب الوضع وحالة المزامنة. لا تضع أسرارًا فيها، وراجع سياسة الخصوصية والمعاينة قبل المشاركة.",
    "What happens to uploaded files?": "ماذا يحدث للملفات المرفوعة؟",
    "Files are processed and stored as needed for the chat, project, or Library feature you use. Delete them with the relevant product controls and review the Privacy Policy for retention details.":
      "تُعالج الملفات وتُخزن حسب الميزة المستخدمة. احذفها من عناصر التحكم المعنية وراجع سياسة الخصوصية لمدة الاحتفاظ.",
    "What data do integrations share?": "ما البيانات التي تشاركها التكاملات؟",
    "The provider consent screen lists granted scopes. Requested content and action details may be sent to the connected provider; revoke access in Apps or with the provider.":
      "تعرض شاشة الموافقة الأذونات الممنوحة، وقد يُرسل المحتوى وتفاصيل الإجراء إلى المزود؛ ألغِ الوصول من التطبيقات أو لدى المزود.",
    "How do I export my data?": "كيف أصدّر بياناتي؟",
    "Open Settings and use the available data export control. Wait for the export to complete; contact support if the control is unavailable or the export fails.":
      "افتح الإعدادات واستخدم تصدير البيانات وانتظر اكتماله؛ وتواصل مع الدعم إن لم يتوفر أو فشل.",
    "How do I delete my account?": "كيف أحذف حسابي؟",
    "Open Settings → Data controls and choose Schedule deletion. The account and data remain recoverable for 30 days; use Recover account before the displayed deadline to keep the same account. Scheduling or recovery does not cancel billing or reset your first-month discount. Use Billing to cancel separately if needed.":
      "افتح الإعدادات ← عناصر التحكم في البيانات واختر جدولة الحذف. يمكن استرداد الحساب والبيانات لمدة 30 يومًا عبر استرداد الحساب. لا تُلغي الجدولة أو الاسترداد الفوترة ولا تعيد خصم الشهر الأول؛ ألغِ الاشتراك منفصلًا من الفوترة عند الحاجة.",
    "What happens when I delete my account?": "ماذا يحدث عند حذف حسابي؟",
    "Scheduling starts a 30-day recovery window without erasing your account or data. Final cleanup starts only after that deadline and must verify subscription retirement and private-data cleanup before removing the sign-in account. Pending status is not proof that deletion finished. Some billing, security, legal, backup, or external-provider records may remain as described in the Privacy Policy.":
      "تبدأ الجدولة مهلة استرداد مدتها 30 يومًا دون حذف حسابك أو بياناتك. يبدأ التنظيف النهائي بعد ذلك ويتحقق من إنهاء الاشتراك وحذف البيانات الخاصة قبل إزالة الحساب. الحالة المعلقة لا تعني اكتمال الحذف. قد تبقى بعض سجلات الفوترة أو الأمان أو السجلات القانونية أو النسخ الاحتياطية أو المزودين وفق سياسة الخصوصية.",
    "Does KovaGPT support MFA?": "هل يدعم KovaGPT المصادقة متعددة العوامل؟",
    "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.":
      "يمكنك إدارتها من الإعدادات إذا كانت طريقة دخولك تدعمها.",
    "What should I do if someone accessed my account?": "ماذا أفعل إذا دخل أحد إلى حسابي؟",
    "Secure your email or identity-provider account first, change applicable credentials, revoke unfamiliar sessions or integrations, enable MFA where supported, and contact support.":
      "أمّن بريدك أو حساب مزود الهوية أولًا، وغيّر بيانات الاعتماد، وألغِ الجلسات أو التكاملات غير المألوفة، وفعّل المصادقة متعددة العوامل، ثم تواصل مع الدعم.",
    "Can support see my password?": "هل يرى الدعم كلمة مروري؟",
    "No. Never send a password, one-time code, passkey, recovery code, or full payment-card number to support.":
      "لا. لا ترسل أبدًا كلمة مرور أو رمزًا لمرة واحدة أو مفتاح مرور أو رمز استرداد أو رقم بطاقة كاملًا.",
    "How do I contact KovaGPT about privacy?": "كيف أتواصل مع KovaGPT بشأن الخصوصية؟",
    "Use the support form below, choose Privacy & security, and send it from the email associated with your account. You can also email support@kovagpt.com.":
      "استخدم النموذج أدناه واختر الخصوصية والأمان وأرسله من بريد حسابك، أو راسل support@kovagpt.com.",
    "What are Scheduled Tasks?": "ما المهام المجدولة؟",
    "Scheduled Tasks are records for recurring or event-driven workflows. Background scheduled execution is unavailable in this deployment; previously saved task records can still be managed.":
      "هي سجلات لمهام متكررة أو مرتبطة بالأحداث. التنفيذ في الخلفية غير متاح في هذا الإصدار، ويمكن إدارة المهام المحفوظة سابقًا.",
    "Why can I not create a Scheduled Task?": "لماذا لا أستطيع إنشاء مهمة مجدولة؟",
    "Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat are connected. Previously saved task records can still be managed.":
      "التنفيذ المجدول غير متاح حتى ربط مجدول معتمد ونشط، ويمكن إدارة المهام المحفوظة سابقًا.",
    "Can I edit, pause, or delete a saved task?": "هل يمكنني تعديل مهمة أو إيقافها أو حذفها؟",
    "Open Scheduled Tasks from the sidebar and use the controls shown for an existing record. Managing a record does not make unavailable background execution active.":
      "افتح المهام المجدولة من الشريط الجانبي واستخدم عناصر التحكم لكل مهمة. إدارتها لا تفعّل التنفيذ في الخلفية.",
    "KovaGPT is slow or not responding.": "KovaGPT بطيء أو لا يستجيب.",
    "Retry the action once, refresh, check your connection, and close unusually heavy tabs. Sign out and in if appropriate, disable interfering extensions, then try another current browser or device.":
      "أعد المحاولة مرة وحدّث الصفحة وافحص اتصالك وأغلق علامات التبويب الثقيلة. سجّل الخروج والدخول عند الحاجة وعطّل الإضافات المعيقة ثم جرّب متصفحًا أو جهازًا آخر.",
    "A message is stuck on Thinking.": 'رسالة عالقة عند "يفكر".',
    "Stop the response, retry once, then refresh and check your connection. Try a shorter request or faster mode; if it repeats, contact support with the time and mode.":
      "أوقف الرد وأعد المحاولة مرة ثم حدّث الصفحة وافحص الاتصال. جرّب طلبًا أقصر أو وضعًا أسرع؛ وإن تكرر فتواصل مع الدعم مع الوقت والوضع.",
    "My message failed to send.": "فشل إرسال رسالتي.",
    "Retry once, check your connection and remaining allowance, then refresh. Remove unsupported attachments, sign out and in, and try another current browser before contacting support.":
      "أعد المحاولة مرة وافحص الاتصال والرصيد ثم حدّث الصفحة. أزل المرفقات غير المدعومة وسجّل الخروج والدخول وجرّب متصفحًا آخر قبل التواصل مع الدعم.",
    "Search is not working.": "البحث لا يعمل.",
    "Retry, confirm Search is selected, and open a normal public query. Refresh, check your connection and allowance, disable blockers that prevent requests, then contact support.":
      "أعد المحاولة وتأكد من اختيار البحث وجرّب استعلامًا عامًا عاديًا. حدّث الصفحة وافحص الاتصال والرصيد وعطّل أدوات الحظر ثم تواصل مع الدعم.",
    "An image will not generate.": "لا يتم إنشاء الصورة.",
    "Retry with supported settings and a policy-compliant prompt. Check your image allowance and connection, refresh, and try another current browser before contacting support.":
      "أعد المحاولة بإعدادات مدعومة وطلب متوافق مع السياسات. افحص رصيد الصور والاتصال وحدّث الصفحة وجرّب متصفحًا آخر قبل التواصل مع الدعم.",
    "Uploads keep failing.": "الرفع يفشل باستمرار.",
    "Confirm the type, size, and allowance, then retry one file at a time. Refresh, check the connection, remove privacy extensions that block uploads, and try another current browser.":
      "تأكد من النوع والحجم والرصيد وأعد المحاولة بملف واحد في كل مرة. حدّث الصفحة وافحص الاتصال وأزل الإضافات التي تمنع الرفع وجرّب متصفحًا آخر.",
    "My subscription is not showing.": "اشتراكي لا يظهر.",
    "Refresh Settings → Billing, verify you are in the purchasing account, then sign out and in. Do not purchase twice; contact support with the receipt if it remains missing.":
      "حدّث الإعدادات ← الفوترة وتأكد أنك في حساب الشراء ثم سجّل الخروج والدخول. لا تشترِ مرتين، وتواصل مع الدعم مع الإيصال إن ظل غير ظاهر.",
    "The page looks broken or my sidebar disappeared.":
      "الصفحة تبدو معطلة أو اختفى الشريط الجانبي.",
    "Refresh and reset browser zoom, then widen the window or use the mobile navigation control. Disable extensions that alter pages and try another current browser.":
      "حدّث الصفحة وأعد ضبط التكبير ثم وسّع النافذة أو استخدم تنقل الجوال. عطّل الإضافات التي تغيّر الصفحات وجرّب متصفحًا آخر.",
    "Why is a feature missing on another device?": "لماذا تغيب ميزة على جهاز آخر؟",
    "Confirm both devices use the same account, plan, app version, and relevant settings. Some browser capabilities and unsynced local data are device-specific.":
      "تأكد من أن الجهازين يستخدمان الحساب والخطة والإصدار والإعدادات نفسها. بعض ميزات المتصفح والبيانات المحلية غير المتزامنة خاصة بالجهاز.",
    "I see an error message. What should I send support?": "أرى رسالة خطأ. ماذا أرسل للدعم؟",
    "Include the exact message, page, time, what you clicked, expected result, browser and device, and any visible correlation ID. Remove secrets and payment details from screenshots.":
      "أرسل نص الرسالة والصفحة والوقت وما نقرت عليه والنتيجة المتوقعة والمتصفح والجهاز وأي معرّف ظاهر. احذف الأسرار وبيانات الدفع من اللقطات.",
    "How do I contact support?": "كيف أتواصل مع الدعم؟",
    "Use the form below or email support@kovagpt.com. Include the account email, relevant page, what happened, and what you expected.":
      "استخدم النموذج أدناه أو راسل support@kovagpt.com مع بريد الحساب والصفحة وما حدث وما كنت تتوقعه.",
    "How do I report a bug?": "كيف أبلغ عن خطأ؟",
    "Choose Bug report below and describe reproducible steps, the result, the expected result, browser and device, and any error or correlation ID.":
      "اختر الإبلاغ عن خطأ أدناه وصف الخطوات والنتيجة والمتوقع والمتصفح والجهاز وأي خطأ أو معرّف.",
    "Can I request a feature?": "هل يمكنني طلب ميزة؟",
    "Yes. Choose Feature request in the support form and explain the problem you want to solve rather than sending sensitive data.":
      "نعم. اختر طلب ميزة في نموذج الدعم واشرح المشكلة التي تريد حلها دون إرسال بيانات حساسة.",
    "What should I never send support?": "ما الذي لا يجب إرساله للدعم أبدًا؟",
    "Never send passwords, one-time codes, passkeys, recovery codes, API secrets, or full payment-card numbers.":
      "لا ترسل أبدًا كلمات المرور أو الرموز لمرة واحدة أو مفاتيح المرور أو رموز الاسترداد أو أسرار API أو أرقام البطاقات الكاملة.",
    "What is included in Free?": "ماذا تتضمن خطة Free؟",
    "Try KovaGPT with very limited usage. Argon Lite and Medium (Thinking). Organize related chats in Projects. Find saved files and images in Library. Very limited chat usage. Usage limits apply to all chat models. Limited image generation. Limited file uploads. Cloud storage included. Search and image generation when their configured providers are available. Basic memory when enabled.":
      "جرّب KovaGPT باستخدام محدود جدًا. Argon Lite والمتوسط (يفكر). نظّم المحادثات في المشاريع، واعثر على الملفات والصور في المكتبة. استخدام محادثة محدود جدًا مع حدود لكل النماذج. إنشاء صور ورفع ملفات محدودان. تخزين سحابي مضمّن. البحث وإنشاء الصور عند توفر المزودين. ذاكرة أساسية عند التفعيل.",
    "What is included in Plus?": "ماذا تتضمن خطة Plus؟",
    "Expanded dynamic usage, with all seven models through Max. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, and Max. Organize related chats in Projects. Find saved files and images in Library. Expanded dynamic chat usage. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Enhanced memory when enabled.":
      "استخدام موسّع مع النماذج السبعة حتى الأقصى: Lite والمتوسط والعالي والعالي جدًا والأقصى، مع حدود لكل النماذج. نظّم المحادثات في المشاريع واعثر على الملفات والصور في المكتبة. إنشاء صور ورفع ملفات موسّعان. تخزين سحابي مضمّن. البحث وإنشاء الصور عند توفر المزودين. ذاكرة محسّنة عند التفعيل.",
    "What is included in Pro?": "ماذا تتضمن خطة Pro؟",
    "Our highest dynamic usage, with all seven models through Ultra. Usage limits apply to all chat models. All seven models: Lite, Medium, High, Extra High, Max, and Ultra. Organize related chats in Projects. Find saved files and images in Library. Highest dynamic chat allowance. Usage limits apply to all chat models. Expanded image generation. Expanded file uploads. Cloud storage included. Search and image generation when their configured providers are available. Extended memory when enabled.":
      "أعلى استخدام لدينا مع النماذج السبعة حتى Ultra: Lite والمتوسط والعالي والعالي جدًا والأقصى وUltra، مع حدود لكل النماذج. نظّم المحادثات في المشاريع واعثر على الملفات والصور في المكتبة. إنشاء صور ورفع ملفات موسّعان. تخزين سحابي مضمّن. البحث وإنشاء الصور عند توفر المزودين. ذاكرة ممتدة عند التفعيل.",
    "Getting started": "البدء",
    "Account & sign-in": "الحساب وتسجيل الدخول",
    "Chat & modes": "المحادثة والأوضاع",
    "Search & research": "البحث والتحري",
    "Files & images": "الملفات والصور",
    "Library & sharing": "المكتبة والمشاركة",
    "Apps & integrations": "التطبيقات والتكاملات",
    "Local places": "الأماكن المحلية",
    "Settings & memory": "الإعدادات والذاكرة",
    "Billing & plans": "الفوترة والخطط",
    "Privacy & security": "الخصوصية والأمان",
    Troubleshooting: "استكشاف الأخطاء",
    "Contact & support": "التواصل والدعم",
    "Help categories": "فئات المساعدة",
    Back: "رجوع",
    "KovaGPT Help Center": "مركز مساعدة KovaGPT",
    "How can we help?": "كيف يمكننا المساعدة؟",
    "Search answers, browse common topics, or contact KovaGPT Support.":
      "ابحث عن إجابات أو تصفّح المواضيع الشائعة أو تواصل مع دعم KovaGPT.",
    "Search help…": "البحث في المساعدة…",
    "Search help": "البحث في المساعدة",
    "Try a different search or send us a message below.": "جرّب بحثًا آخر أو أرسل لنا رسالة أدناه.",
    "Show more answers": "عرض مزيد من الإجابات",
    "Find a fix for your setup": "اعثر على حل لإعدادك",
    "Choose your issue, browser, connection, plan, and when it began for specific next steps. These paths combine our help articles with setup checks; they are not separate reports of every possible problem.":
      "اختر المشكلة والمتصفح والاتصال والخطة ووقت بدء المشكلة للحصول على خطوات محددة. تجمع هذه المسارات مقالات المساعدة مع فحوص الإعداد، وليست تقارير عن كل مشكلة محتملة.",
    "Your issue": "مشكلتك",
    "Help issue": "المشكلة",
    "Browser & device": "المتصفح والجهاز",
    "Help browser": "المتصفح",
    Connection: "الاتصال",
    "Help connection": "الاتصال",
    "Kova plan": "خطة Kova",
    "Help plan": "الخطة",
    "When it started": "متى بدأت",
    "Help stage": "التوقيت",
    "Troubleshooting steps": "خطوات الحل",
    "Loading support form…": "جارٍ تحميل نموذج الدعم…",
    "Request accepted": "تم قبول الطلب",
    "Send another message": "إرسال رسالة أخرى",
    "Still need help?": "هل ما زلت بحاجة إلى مساعدة؟",
    "Can’t find the answer you’re looking for? Send a message to KovaGPT Support and we’ll reply by email.":
      "لم تجد الإجابة؟ أرسل رسالة إلى دعم KovaGPT وسنرد عبر البريد.",
    Optional: "اختياري",
    Topic: "الموضوع",
    "Choose a topic": "اختر موضوعًا",
    "Tell us what happened, what you expected, and any error message you saw.":
      "أخبرنا بما حدث وما توقعته وأي رسالة خطأ رأيتها.",
    "We’ll use your email only to respond to this support request.":
      "سنستخدم بريدك فقط للرد على هذا الطلب.",
    "Sending…": "جارٍ الإرسال…",
    "Support request status": "حالة طلب الدعم",
    "Your message is still here.": "رسالتك ما زالت هنا.",
    Features: "الميزات",
    Learn: "تعلّم",
    Business: "الأعمال",
    Pricing: "الأسعار",
    Review: "المراجعات",
    "Open KovaGPT": "فتح KovaGPT",
    "Open app": "فتح التطبيق",
    "All projects": "كل المشاريع",
    "My projects": "مشاريعي",
    "Shared with me": "مشاركة معي",
    "Browse answers": "تصفّح الإجابات",
    "Try “cancel subscription”, “can’t login”, “slow”, or “Google mail”.":
      'جرّب "إلغاء الاشتراك" أو "لا أستطيع الدخول" أو "بطيء" أو "بريد Google".',
  },
};
