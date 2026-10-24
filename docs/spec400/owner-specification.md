**Paste the full list below into the LLM working on your prototype. It defines one specific design direction, including the individual pages and interactions.** I could not inspect the ZIP because the execution workspace is unavailable, so this is a target specification for the pages you named, not a verified audit of that build.

1. **Implement this as KovaGPT’s complete interface specification.** Apply it across the supplied application, including Chat, Projects, Scheduled tasks, Library, Plugins, Settings, Profile, authentication, Usage, Billing, and Subscriptions.

2. **Continue the supplied project.** Inspect its existing routes, components, assets, interactions, and data structures before editing. Preserve working functionality and existing user data.

3. **Stop using percentage similarity to ChatGPT as the design objective.** Build the exact Kova interface described here instead of combining recognizable pieces of competing products.

4. **Use this visual direction throughout:** precise graphite surfaces, restrained blue accents, readable typography, structured panels, compact navigation, generous reading space, and immediately understandable controls.

5. **Make the application feel like a polished productivity tool.** Remove the visual conventions of generic AI landing pages: purple gradients, sparkle symbols, glowing orbs, floating brains, decorative circuitry, and oversized promotional headings.

6. **Keep Chat as the familiar name for conversations.** Use Project for a collection of related work, Library for stored files and outputs, and Scheduled task exclusively for an automation.

7. **Keep the sidebar.** Redesign it into a stable navigation system that provides access to the main product areas instead of letting chat history dominate the entire application.

8. **Keep existing business rules authoritative.** Do not change subscription prices, entitlements, usage limits, billing timing, authentication policies, or connector permissions while redesigning their presentation.

9. **Use real application configuration for variable facts.** Retrieve prices, storage limits, upload limits, supported models, connector availability, and reset times from their existing source. Never invent values to complete a screen.

10. **Separate demonstration behavior from connected functionality.** A prototype may use labeled example data; a connected application must show success only after the underlying operation succeeds.

11. **Do not introduce unsupported capabilities.** Remove controls for unavailable features from ordinary workflows. Keep a clear explanation where an existing feature is temporarily unavailable.

12. **Keep Voice and Deep Research outside this redesign.** Do not add their buttons, settings, empty pages, or promotional cards.

13. **Preserve the approved Kova logo.** Reuse the supplied source asset, maintain its proportions, and use its approved light and dark variants.

14. **Create shared components before redesigning individual screens.** Implement one sidebar, header, button system, form system, dialog system, content-box system, and notification system.

15. **Create an interaction inventory.** Record every visible control, its event, its resulting state, its error behavior, and the screen where it appears. A control is unfinished until these are defined.

16. **Make the main sidebar order:** New chat, Search, Chat, Projects, Scheduled tasks, Library, Plugins. Place recent chats underneath this navigation group.

17. **Preserve additional enabled product areas.** Apply the same page and control patterns to an existing Work area without inventing new navigation destinations for disabled capabilities.

18. **Keep account utilities at the bottom of the sidebar.** Place Help above the profile control. Open Settings, Usage, and Billing from the profile menu.

19. **Use these exact primary labels:** “New chat,” “Search,” “Chat,” “Projects,” “Scheduled tasks,” “Library,” and “Plugins.” Do not alternate between synonyms across screens.

20. **Keep existing conversation URLs working.** Preserve the application’s established conversation identifiers and deep links. Changing the interface must not invalidate saved links.

21. **Give every main destination a stable URL.** Direct navigation, refresh, browser Back, browser Forward, and opening in another tab must reach the correct screen.

22. **Map renamed routes through redirects.** Do not leave an old route as a blank screen or silently send every outdated link to the homepage.

23. **Preserve navigation state.** Returning to a list must restore its search query, filters, selected view, and scroll position.

24. **Preserve unfinished input while navigating.** Keep drafts attached to their original conversation, form, or document instead of sharing one global draft across unrelated pages.

25. **Use breadcrumbs on detail pages.** Display paths such as “Projects / Website launch” and “Library / Proposal draft.” Make parent segments clickable.

26. **Use one page title per screen.** Do not repeat the same title in the header, a large hero, and another card immediately underneath.

27. **Keep main actions in predictable positions.** Put the page’s primary action at the upper right on desktop and in the page header on mobile.

28. **Use object-specific overflow menus.** A project menu must contain project actions; a file menu must contain file actions. Do not reuse an unrelated generic menu.

29. **Do not bury primary navigation inside the account menu.** Projects, Library, Scheduled tasks, and Plugins must remain directly accessible from the sidebar.

30. **Keep familiar controls recognizable.** Use standard search, tabs, buttons, fields, and menus. Distinctiveness must come from the coherent system and workflow rather than unfamiliar symbols.

31. **Use a 248-pixel expanded desktop sidebar.** Keep its width fixed while the main content adapts to the remaining viewport.

32. **Use a 72-pixel collapsed desktop sidebar.** Show centered icons, selected-state markers, accessible names, and tooltips on both hover and keyboard focus.

33. **Use the persistent desktop sidebar at viewport widths of 1,024 CSS pixels and above.** Below that width, replace it with the navigation drawer.

34. **Make the sidebar header 64 pixels tall.** Place the logo at the left and the collapse control at the right, with 16 pixels of horizontal inset.

35. **Render the sidebar logo symbol at 28×28 pixels.** Keep the wordmark beside it in expanded mode and hide the wordmark in collapsed mode.

36. **Make New chat a 44-pixel-tall button.** Give it 16-pixel outer margins, an eight-pixel corner radius, a plus icon, and the visible label “New chat.”

37. **Make sidebar navigation rows 44 pixels tall.** Use 12-pixel horizontal padding, 20-pixel icons, 12 pixels between icon and label, and four pixels between rows.

38. **Use 14-pixel, weight-500 sidebar labels.** Keep labels on one line. Reveal the full label through accessible text when space is constrained.

39. **Mark the selected sidebar row with a neutral raised background and a two-pixel accent marker.** Preserve the marker in collapsed mode.

40. **Use hover as a temporary neutral background change.** Do not make hover visually identical to the selected state.

41. **Separate navigation from recent chats with 20 pixels of space and a “Recent chats” label.** Do not use a large decorative divider card.

42. **Show eight recent chats initially.** Add “View all chats” beneath them. Keep the full history in a dedicated searchable view.

43. **Keep the sidebar footer fixed while recent chats scroll.** New chat and primary navigation must remain reachable without scrolling through history.

44. **Use a 56-pixel profile row in the footer.** Include a 32-pixel avatar, display name, current plan in secondary text, and a chevron.

45. **Open the profile menu above the profile row.** Use this order: Profile, Settings, Usage, Billing, Help, divider, Log out.

46. **Display the signed-in account clearly.** Use the actual display name and email. Do not invent initials or an account name while profile data is still loading.

47. **Use a 64-pixel desktop main header.** Align its bottom edge with the sidebar header and separate it from the body with a subtle divider.

48. **Use a 56-pixel mobile main header.** Put the navigation button on the left, the current page title next, and contextual actions on the right.

49. **Use 32-pixel main-content padding on desktop, 24 pixels on tablets, and 16 pixels on phones.** Include safe-area padding where the device requires it.

50. **Limit ordinary management pages to 1,200 pixels of content width.** Center that region within the available main area.

51. **Limit the ordinary chat reading column to 760 pixels.** Center the column without adding an empty decorative panel beside it.

52. **Use a two-pane layout only when an editable result exists.** Allocate 45% to conversation and 55% to the result when the available main area is at least 1,000 pixels wide.

53. **Keep each result-layout pane at least 420 pixels wide.** Below the required available width, switch to labeled Conversation and Result tabs.

54. **Make the pane divider resizable.** Save the ratio on the current device and provide a “Reset layout” action returning it to 45/55.

55. **Add a Context drawer that is 300 pixels wide on desktop.** Open it from the conversation header; do not permanently create a third narrow working column.

56. **Use a 420-pixel inspector for Sources, Versions, and file details.** Show only one inspector at a time and preserve its internal state when switching tabs.

57. **Make drawers full-screen on phones.** Include a 56-pixel header, a visible Close button, and a clear title identifying the inspected object.

58. **Use a maximum three-column project grid.** Use three columns when the content container is at least 960 pixels wide, two at 620–959 pixels, and one below 620 pixels.

59. **Use 24-pixel grid gaps on desktop and 16 pixels on mobile.** Do not make cards touch the viewport edges.

60. **Keep scroll ownership clear.** Management pages use page scrolling; split work views give each working pane one scroll region. Avoid nested scrolling inside ordinary paragraphs.

61. **Use `#121619` as the dark application background.** Apply it behind the main working area and sidebar.

62. **Use `#1B2126` as the dark surface color.** Apply it to panels, content boxes, inputs, and project cards.

63. **Use `#252D34` as the dark raised-surface color.** Apply it to menus, selected neutral rows, and elevated control groups.

64. **Use `#2D3740` for dark hover surfaces.** Apply it consistently to neutral interactive rows and secondary controls.

65. **Use `#35424D` for dark pressed surfaces.** Do not simulate pressing by shrinking the entire button.

66. **Use `#F2F5F7` for primary dark text.** Use `#B0BAC5` for secondary dark text and `#8D9BA8` for nonessential tertiary metadata.

67. **Use `#323D47` for decorative dark dividers.** Use a stronger functional boundary token for fields and controls that require a visible outline.

68. **Use `#718392` for dark functional outlines.** Check it against every adjacent surface used by the component.

69. **Use `#9AD8FF` as the default dark accent.** Restrict it to links, focus indicators, selection markers, and small meaningful highlights.

70. **Use `#F5F7F8` as the light application background.** Use `#FFFFFF` for working surfaces and `#EAF0F3` for raised neutral areas.

71. **Use `#DFE7EC` for light hover surfaces and `#D2DEE6` for light pressed surfaces.** Keep these separate from permanent selection.

72. **Use `#172126` for primary light text.** Use `#4F5E69` for secondary light text and `#5F6F7B` for tertiary metadata.

73. **Use `#CFD8DE` for decorative light dividers.** Use `#7C8B96` for functional light input outlines.

74. **Use `#005F8F` as the default light accent.** Do not reuse the pale dark-theme accent as small text on white.

75. **Use neutral primary buttons.** In dark mode, use `#F2F5F7` with `#121619` text. In light mode, use `#172126` with white text.

76. **Use these dark semantic foreground colors:** success `#93D4AA`, warning `#F3BF72`, and error `#FF9A9A`. Apply them to icons and supporting text rather than enormous saturated backgrounds.

77. **Use these light semantic foreground colors:** success `#23683C`, warning `#8A5100`, and error `#AD273E`. Pair them with explicit status wording.

78. **Use `rgba(0,0,0,0.48)` for modal backdrops.** Keep the dialog itself opaque.

79. **Keep ordinary text contrast at least 4.5:1.** Qualifying large text may use 3:1. Validate actual text/background pairs, including placeholders and hover states. [www.w3.org](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html?utm_source=chatgpt.com)

80. **Validate functional control contrast separately.** Essential boundaries, icons, and state indicators must satisfy the applicable non-text contrast requirements. [www.w3.org](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast?utm_source=chatgpt.com)

81. **Use IBM Plex Sans for interface text and prose.** Load the required font files locally and use a system sans-serif fallback while they load.

82. **Use IBM Plex Mono for code and technical identifiers only.** Do not use monospace for page navigation, ordinary answers, or billing descriptions.

83. **Use interface weights 400, 500, and 600.** Reserve weight 600 for headings, selected labels, and primary emphasis.

84. **Use 15/22-pixel interface text.** Implement scalable equivalents so browser font preferences remain effective.

85. **Use 16/26-pixel answer text.** Keep this identical between conversation responses and ordinary document editing.

86. **Use 28/36-pixel page headings on desktop and 24/32 on phones.** Use weight 600 and normal letter spacing.

87. **Use 20/28-pixel section headings and 16/24-pixel subsection headings.** Do not create additional improvised heading sizes.

88. **Use 13/18-pixel metadata.** Use 12/16 only for nonessential compact labels such as keyboard hints.

89. **Use 14/22-pixel code text.** Use tabular numerals for usage counters, dates in aligned columns, and changing timers.

90. **Keep prose left-aligned.** Center only short empty-state headings and authentication-card headings; never center long explanatory paragraphs.

91. **Use sentence case throughout.** Write “Scheduled tasks,” “Manage subscription,” and “Add files.” Do not use all-caps section titles.

92. **Use spacing tokens of 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64 pixels.** Store them centrally instead of scattering arbitrary values through components.

93. **Use eight pixels between icons and labels in buttons.** Use 12 pixels between icons and labels in navigation rows.

94. **Use 16-pixel internal padding for compact panels and 24 pixels for substantial panels.** Use 12 pixels inside dense toolbar groups.

95. **Use 24 pixels between related page sections and 32 pixels between major sections.** Do not insert huge blank areas to make a sparse page appear premium.

96. **Use eight-pixel button and input corners, 12-pixel content-box corners, and 16-pixel dialog corners.** Use fully rounded corners only for avatars and small status badges.

97. **Use one-pixel borders for ordinary surfaces.** Use a two-pixel focus ring with a two-pixel offset.

98. **Use one shadow token for menus and another for dialogs.** Start with `0 8px 24px rgba(0,0,0,0.18)` and `0 16px 48px rgba(0,0,0,0.28)` respectively.

99. **Remove decorative shadows from ordinary cards.** Differentiate them with their surface color, border, padding, and alignment.

100. **Give every button one visual surface.** Do not place an extra gray rectangle behind its icon or inside its label area.

101. **Use 44-pixel default buttons with 16-pixel horizontal padding.** Use a 44×44-pixel hit area for ordinary icon buttons.

102. **Use one icon family with a consistent 20-pixel size and stroke weight.** Use the supplied brand logos for plugins rather than replacing them with unrelated symbols.

103. **Make primary buttons fit their labels on desktop.** Make primary form-submit buttons full-width on narrow mobile forms.

104. **Keep secondary buttons neutral and destructive buttons clearly labeled.** Do not make every control a filled primary button.

105. **Implement button states explicitly:** default, hover, pressed, keyboard focus, disabled, and loading. Preserve the button’s width when its label changes.

106. **Use a 16-pixel spinner in loading buttons.** Keep a meaningful label such as “Saving…” visible beside it.

107. **Prevent repeat activation while an operation is pending.** A double click must not create two projects, subscriptions, schedules, or messages.

108. **Explain disabled actions in persistent supporting text when the reason matters.** Do not depend on a hover tooltip that mobile users cannot access.

109. **Use explicit action names.** Write “Create project,” “Save schedule,” and “Download PDF,” rather than generic “Continue” buttons when the outcome is known.

110. **Keep ordinary icon tooltips short.** Show them after approximately 400 milliseconds on hover and immediately on keyboard focus.

111. **Do not put required instructions inside tooltips.** Show requirements beside the relevant field or control.

112. **Use 44-pixel menu rows.** Give menus eight pixels of outer padding and a maximum height that fits inside the viewport.

113. **Use menu search when a selectable list exceeds seven items.** Keep the search field inside the menu and preserve keyboard navigation.

114. **Use checkmarks to show the currently selected menu value.** Do not make users infer selection from a barely different background.

115. **Put destructive menu actions after a divider.** Keep Delete separated from Rename, Move, and Duplicate.

116. **Use tabs only for views of the same object or page.** Use navigation links for unrelated pages.

117. **Make the active tab visible through text weight and an underline.** Use a 44-pixel minimum tab height.

118. **Use switches for settings that save immediately.** Use checkboxes for selections submitted together through a Save button.

119. **Use radios for mutually exclusive choices.** Make the label and supporting description part of the clickable target.

120. **Use persistent form labels above inputs.** Place helper text below the label and validation errors below the field.

121. **Use 44-pixel text inputs with 12-pixel horizontal padding.** Use 16-pixel input text on phones.

122. **Keep textarea resizing available on desktop where it helps.** Use controlled expansion in docked composers so resizing does not cover page controls.

123. **Validate fields after they have been visited and after submission.** Do not display a wall of red errors immediately when a blank form opens.

124. **Preserve valid form input after submission fails.** Keep focus near the error instead of resetting the entire page.

125. **Use specific field-error messages.** Write “Enter a project name” and “Choose a future start time.” Avoid “Something is invalid.”

126. **Add an error summary to long submitted forms.** Link each summary item to its corresponding field. [design-system.service.gov.uk](https://design-system.service.gov.uk/components/error-summary/?utm_source=chatgpt.com)

127. **Use a 560-pixel maximum width for standard dialogs.** Apply 24-pixel padding and a 24-pixel gap between the dialog body and footer.

128. **Place dialog actions in the footer.** Put Cancel first and the primary action second on desktop; stack full-width actions on narrow phones.

129. **Give every dialog a visible title and close control.** Clicking the backdrop may close a harmless dialog, but it must not discard unsaved edits without a decision.

130. **Manage modal focus properly.** Move focus inside, contain Tab navigation while modal, support Escape, and restore focus to the invoking control when closed. [www.w3.org](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/?utm_source=chatgpt.com)

131. **Use confirmation dialogs for destructive consequences.** State the object name and consequence rather than asking “Are you sure?”

132. **Use a 360-pixel-wide desktop toast region near the bottom right.** On mobile, use the available width minus 32 pixels and keep it clear of the composer.

133. **Dismiss ordinary success toasts after four seconds.** Keep errors requiring action visible until dismissed or resolved.

134. **Do not place important success information only in a toast.** The page itself must reflect the newly saved project, schedule, file, or preference.

135. **Show “Saving…” and “Saved” only when accurate.** Do not display a permanent Saved label before persistence completes.

136. **Use empty states with one heading, one explanation, and one primary action.** Avoid decorative illustrations that consume more space than the usable content.

137. **Use skeletons that match the eventual component dimensions.** Do not replace a short row with a large unrelated loading animation.

138. **Keep error panels compact and actionable.** Include what failed, what remains preserved, and the next available action.

139. **Use “Retry” only when retrying is safe.** External changes with uncertain outcomes require checking the existing operation before repeating it.

140. **Keep all standard components responsive by construction.** Long labels, translated text, large font settings, and validation messages must not break their dimensions.

141. **Make the initial Chat page a useful starting point.** Place a short heading, the composer, three starter actions, and a compact recent-work section in the central column.

142. **Use the exact initial heading “What are you working on?”** Set it to 28/36 pixels on desktop and 24/32 on mobile.

143. **Use the exact composer placeholder “Describe what you need…”** Keep examples outside the input so the placeholder remains short.

144. **Use these three initial starter actions:** “Write something,” “Summarize a file,” and “Compare options.” Each fills a draft and focuses the composer without submitting automatically.

145. **Place “Continue working” below the starting composer.** Show three recent conversations with title, project, and last-opened time.

146. **Do not show recent work in a guest or genuinely empty account.** Replace it with a short explanation of the available capabilities.

147. **Make the ordinary chat composer a docked rectangular panel.** Use a surface background, a functional border, 12-pixel corners, and 12-pixel internal padding.

148. **Use a minimum desktop composer height of 128 pixels.** Let the text region expand while keeping the toolbar visible.

149. **Use a minimum mobile composer height of 120 pixels.** Limit the text region to 144 pixels before it scrolls internally.

150. **Use a 160-pixel starting composer on the empty Chat page.** Return to the smaller docked composer after the conversation begins.

151. **Keep the composer toolbar in one predictable row.** Put Attach, Context, and Options on the left and Send on the right.

152. **Use a visible Send label on desktop.** Use a familiar send icon with the accessible name “Send message” on mobile.

153. **Disable Send when the prompt is empty and no valid attachment-based instruction exists.** Do not send blank requests.

154. **Use Enter to send and Shift-Enter for a new line on desktop.** Support Command-Enter and Control-Enter as explicit send shortcuts.

155. **Use Enter for a new line on mobile.** Keep sending attached to the explicit Send control.

156. **Never submit while an input-method composition is active.** Enter used to complete a character must remain part of text entry.

157. **Add an Expand input control.** Open a large editing dialog containing the same draft and return the draft intact when collapsed.

158. **Keep draft saving scoped to the current conversation.** Changing conversations must not overwrite another conversation’s draft.

159. **Respect the privacy mode when storing drafts.** Do not persist temporary-chat text into normal long-term draft storage.

160. **Keep the selected project visible above the composer.** Use a removable project chip; removing it affects the current conversation’s association only after the app confirms the change.

161. **Open Context as a structured list.** Group included material under Project instructions, Files, Saved results, and Conversation context.

162. **Make every context entry inspectable.** Show a readable title, origin, readiness state, and Remove control.

163. **Add `@` insertion for project files and saved results.** Open a searchable picker and insert a named reference instead of a raw identifier.

164. **Do not silently attach an entire account’s files.** Include the selected project context and explicitly attached material according to the existing retrieval rules.

165. **Put Format, Length, Tone, and Effort inside Options.** Keep advanced configuration out of the default typing area.

166. **Default Format to “Automatic.”** Let explicit prompt instructions override the preference.

167. **Default Length to “Standard.”** Provide Concise, Standard, and Detailed as saved preferences without treating them as hard caps on explicit requests.

168. **Default Tone to “Direct.”** Provide Direct, Formal, and Conversational choices with one-sentence descriptions.

169. **Default Effort to Auto within the current plan.** Keep entitled manual settings in the Effort menu and preserve the user’s explicit choice.

170. **Do not change model entitlements through the UI redesign.** Render the available settings from the existing entitlement configuration.

171. **Describe effort settings honestly.** Show their actual usage implications and measured performance information when available. Do not claim that the highest setting guarantees correctness.

172. **Provide an explicit “Improve instructions” action.** Show the proposed rewrite before applying it and include an Undo action.

173. **Preserve the original prompt when improving it.** Do not silently delete requirements, change constraints, or send the revised prompt automatically.

174. **Show attached files as compact rows above the toolbar.** Include a type icon, filename, status, and remove control.

175. **Display attachment limits before selection.** Use the actual supported formats, per-file limit, and remaining allowance.

176. **Use these attachment states:** Queued, Uploading, Processing, Ready, Failed, and Removed. Drive the state from the actual operation.

177. **Show real upload progress when measurable.** Use an indeterminate indicator when the operation cannot report a meaningful percentage.

178. **Keep file upload and file readability separate.** A completed upload must not automatically mean the model successfully extracted its contents.

179. **Show a PDF’s page count and extraction result.** Provide a page-range selection control before the user submits a file-specific request.

180. **Identify partial extraction clearly.** Use text such as “Some pages could not be read” and list the affected pages.

181. **Provide image previews inside attachment rows.** Open the full image when selected, while retaining its name and remove action.

182. **Keep Attach available alongside drag-and-drop.** Users must be able to upload without dragging.

183. **Show the submitted prompt immediately after acceptance by the application.** Keep pending delivery distinguishable from confirmed submission.

184. **Use one request identifier to prevent duplicate sends.** Reconnection and double activation must not create duplicate conversation turns.

185. **Replace Send with Stop while the response is running.** Keep the Stop control visible without requiring scrolling to the latest text.

186. **Distinguish “Stopping…” from “Stopped.”** Show Stopped only when the operation is confirmed stopped; otherwise explain that the request to stop is pending.

187. **Keep the partial answer after stopping.** Offer Continue and Retry as separate actions with clear behavior.

188. **Allow editing the next prompt while generation continues.** Use “Send next” to submit it deliberately rather than automatically queuing incidental typing.

189. **Preserve the user’s scroll position.** Follow new output only while the user remains near the bottom; show “Jump to latest” after they scroll upward.

190. **Show concise connection states near the composer.** Distinguish Offline, Reconnecting, and Connected without displaying technical transport details.

191. **Render assistant responses in an editorial layout.** Use a small “Kova” label, normal prose, consistent headings, and a quiet action row.

192. **Render user messages with a restrained surface treatment.** Keep them aligned with the reading column and avoid oversized right-floating speech bubbles.

193. **Use 24 pixels between conversation turns.** Use 12 pixels between the speaker label and response content.

194. **Lead responses with the requested answer or result.** Remove routine opening filler and generic concluding summaries.

195. **Respect the requested response format.** A numbered-list request produces one numbered list; a request for three paragraphs produces three paragraphs.

196. **Do not shorten an explicit detailed request to satisfy the default response-length setting.** The current user instruction has priority over a saved presentation preference.

197. **Use headings only when they help the content.** Do not impose headings on every brief answer.

198. **Use numbered lists for ordered steps and bullets for parallel items.** Preserve list numbering during streaming and export.

199. **Use real semantic tables for comparisons.** On narrow screens, place wide tables in a labeled horizontal-scrolling region.

200. **Put standalone reusable writing in a rounded content box.** Emails, messages, prompts, letters, and document drafts receive one box per complete deliverable.

201. **Put long assistant prose sections exceeding 800 characters in the same copyable content-box component.** Do not create a separate box around every paragraph.

202. **Put every multiline code block in a code content box.** Keep surrounding explanatory text outside the code box.

203. **Use 12-pixel content-box corners, a one-pixel border, and 16-pixel body padding.** Use the standard surface color rather than a special purple or blue fill.

204. **Give each content box a 44-pixel header.** Put the content label or filename on the left and Copy on the right on desktop.

205. **Place the Copy control beneath the content on mobile.** Use a full-width 44-pixel footer button labeled “Copy text” for prose and “Copy code” for code.

206. **Copy only the content associated with that box.** Exclude its title, toolbar, buttons, and unrelated conversation text.

207. **Change Copy to “Copied” for two seconds after success.** If clipboard access fails, show “Couldn’t copy” and provide selectable content.

208. **Use normal prose typography inside writing boxes.** Keep monospace limited to code and technical text.

209. **Keep prose wrapping enabled inside content boxes.** Preserve deliberate whitespace in code boxes and allow horizontal code scrolling.

210. **Do not collapse ordinary requested writing automatically.** Keep full drafts readable; use explicit expansion only for extremely long technical output.

211. **Add an action row below each completed response.** Include Copy response, Save to Library, feedback, and More.

212. **Put Retry, Continue from here, and Copy link inside More.** Keep destructive conversation actions in the conversation-level menu.

213. **Provide selection-based Ask, Rewrite, Shorten, and Copy actions.** Target the selected text instead of requiring users to describe where it is. Research on AI editing identifies direct editing and passage selection as practical responses to repeated rewriting and excessive scrolling. [www.nngroup.com](https://www.nngroup.com/articles/accordion-editing-apple-picking/?utm_source=chatgpt.com)

214. **Make selection controls avoid covering the selection.** Keep browser selection, mobile handles, and native context menus functional.

215. **Open substantial saved writing in the Result pane.** Keep the conversation visible alongside it when space permits.

216. **Give the Result pane a stable title and toolbar.** Use Edit, Versions, Export, Share, and More in that order.

217. **Allow direct manual editing.** Users must be able to correct a word without sending another AI request.

218. **Keep Undo and Redo available during editing.** Preserve ordinary keyboard behavior inside the editor.

219. **Show proposed AI revisions as a diff.** Provide Accept changes and Reject changes, with individual-change controls for substantial edits.

220. **Apply passage-specific edits locally.** Do not rewrite untouched sections when the user selected one paragraph.

221. **Create recoverable versions after accepted substantial revisions.** Record the version time and whether the change came from the user or an AI operation.

222. **Preview an old version before restoring it.** Restoration creates a new current revision and preserves later history.

223. **Keep one canonical current result.** Do not append the entire document to the conversation after every small edit.

224. **Give long results an outline derived from headings.** Open it from a labeled Outline control and jump to sections without losing editor state.

225. **Preserve formatting on export.** Keep headings, links, lists, tables, citations, and code in supported formats.

226. **Use the result title as the default filename.** Keep the appropriate extension and remove invalid filename characters without changing the title shown in the application.

227. **Give code boxes a language label and filename when known.** Add Download file beside Copy on desktop and below the content on mobile.

228. **Keep generated code previews isolated.** Require an explicit Run preview action and prevent the preview from inheriting authenticated application access.

229. **Display image outputs at their natural aspect ratio.** Use a neutral frame and avoid cropping away meaningful content.

230. **Give generated images Save to Library, Download, and View full size actions.** Display editing controls only when the underlying capability exists.

231. **Keep image-generation status inside the response.** Distinguish generating, completed, failed, and stopped without showing fabricated progress percentages.

232. **Keep reusable outputs retrievable independently of their chat.** Saving a result to Library must provide a stable object and a link back to its source conversation.

233. **Attach citations directly to supported claims.** Do not treat a miscellaneous list of links as evidence for every statement in the response.

234. **Open citations in the Sources inspector.** Show source title, publisher, URL, publication date when known, retrieval time, and the relevant supporting passage.

235. **Distinguish publication date from retrieval time.** Checking an old article today must not make it appear newly published.

236. **Label source types explicitly.** Use Web page, Uploaded file, Project file, and Connected app record where applicable.

237. **Show when web retrieval actually occurred.** Do not display search activity for an answer generated without a web operation.

238. **Do not invent confidence percentages.** Explain the specific uncertainty, missing information, or conflicting evidence instead. Confidence displays can mislead without validation and a clear purpose. [pair.withgoogle.com](https://pair.withgoogle.com/chapter/explainability-trust/?utm_source=chatgpt.com)

239. **Use an Activity panel for real operations.** Show factual events such as files opened, pages retrieved, drafts created, and actions waiting for the user.

240. **Keep hidden model reasoning out of the Activity panel.** Provide useful action summaries, assumptions, and source references instead.

241. **Show elapsed time for long operations.** Display a remaining-time estimate only when the system has a defensible basis for it.

242. **Show the exact proposed external change before approval.** Identify the destination, account, affected content, and consequence.

243. **Use action-specific approval labels.** Write “Publish this page,” “Delete these files,” and “Create scheduled task.”

244. **Keep read-only connectors read-only.** Do not add email sending, file modification, or publishing controls to a connector whose permissions do not support them.

245. **Report partial success accurately.** Use statements such as “Draft saved; export failed” instead of an overall green success state.

246. **Retry only the failed operation.** Do not repeat completed external actions or regenerate already saved work unnecessarily.

247. **Design the Scheduled tasks page with the title “Scheduled tasks.”** Use the subtitle “Run a prompt automatically on a schedule” and the primary button “New scheduled task.”

248. **Use Active, Paused, and All as schedule filters.** Default to Active and show real counts.

249. **Display schedules in a list.** Show title, recurrence, next run, timezone, last-run status, and a More menu.

250. **Use these schedule row actions:** Open, Edit, Pause, Resume, View runs, and Delete. Show Pause only for active schedules and Resume only for paused schedules.

251. **Make the schedule editor 560 pixels wide on desktop.** Use a full-screen editor on mobile with a sticky Save schedule footer.

252. **Include these schedule fields:** Title, Prompt, Frequency, Date where applicable, Time, Timezone, and notification preference. Keep the Prompt field at least 120 pixels tall.

253. **Offer the supported schedule frequencies in a labeled dropdown.** Default a new recurring schedule to Daily at 9:00 AM in the account timezone; require confirmation before creation.

254. **Reveal frequency-specific fields directly below Frequency.** Weekly schedules show weekday selection; monthly schedules show the supported day selection and its actual execution rule.

255. **Display the resolved next three run times before saving.** Obtain them from the scheduling logic and account for timezone and daylight-saving behavior.

256. **Validate that a one-time schedule is in the future.** Preserve the entered prompt when date validation fails.

257. **After confirmed creation, show a gray status bubble directly above Kova’s response.** Use the exact label “Scheduled task created” and a green checkmark.

258. **Style that bubble with the raised neutral surface, eight-pixel corners, 12-pixel horizontal padding, and a 16-pixel success icon.** Make it expand to schedule details when selected.

259. **Show failure instead of the success bubble when creation fails.** Use “Scheduled task not created,” include the actionable reason, and preserve the full proposed schedule.

260. **Give schedule details a run-history section.** Show scheduled time, actual start time, completion status, and a link to the generated result for each real run.

261. **Make Pause and Resume reflect persistence.** Show a pending state, then the confirmed state; revert the switch and explain the failure if saving fails.

262. **Confirm schedule deletion with its title and consequence.** Do not imply that deleting a schedule also deletes its historical results unless that is the actual product behavior.

263. **Design Projects with a page heading, search field, sort control, and New project button.** Keep decorative charts and promotional banners out of this page.

264. **Default project sorting to Last opened.** Offer Name and Last updated in the sort menu and preserve the user’s selection.

265. **Show each project’s name, description, last activity, and pinned state.** Do not invent completion percentages or task counts.

266. **Use project cards with 20-pixel padding and a minimum height of 156 pixels.** Make the name the strongest element and keep metadata at the bottom.

267. **Keep the card body’s click behavior simple.** Open the project from the card body; use a separate More button for Rename, Pin, Archive, and Delete.

268. **Create projects through a short dialog.** Require a name and provide an optional description. Add files and instructions after creation.

269. **Open project details with Chats and Context tabs.** Put project conversations under Chats and persistent instructions and file references under Context.

270. **Provide “New chat in project” inside the project header.** Automatically attach the project association to the new chat.

271. **Make project instructions directly editable.** Show their scope, Save changes, Cancel, and the actual saved state.

272. **Show project files as Library references.** Avoid silently creating separate copies of the same file.

273. **Distinguish Archive from Delete.** Archiving removes a project from active lists while preserving its data according to existing rules.

274. **Explain deletion consequences explicitly.** State what happens to chats, file references, and saved results before the user confirms.

275. **Design Library with Upload, Search, filters, sort, and view controls.** Keep this as the single location for stored inputs and outputs.

276. **Default Library to List view.** Remember Grid view when the user selects it and use it particularly well for images and visual documents.

277. **Use All, Uploads, Documents, Images, and Code as type filters.** Treat them as filtered views of the same underlying collection.

278. **Add Project, Source, and Date filters.** Show active filters as removable chips and provide Clear filters.

279. **Default Library sorting to Last modified, newest first.** Preserve user-selected sorting between visits.

280. **Show filename, type, project, modified date, and processing state in List view.** Keep sensitive file contents out of incidental metadata previews.

281. **Use a separate checkbox for selection.** Clicking the filename opens the file; clicking the checkbox selects it without opening it.

282. **Show a bulk-action bar after selection.** Display the selected count and the supported Move, Download, and Delete actions.

283. **State selection scope clearly.** Distinguish the visible page’s items from the entire filtered collection before a bulk action.

284. **Open file previews in the inspector when sufficient space exists.** Use a full detail page on narrow screens.

285. **Show filename, format, size, origin, project references, and modified time in file details.** Use actual metadata rather than AI-generated guesses.

286. **Provide Preview and Extracted text views for supported documents.** Label extraction failures and partial content clearly.

287. **Link saved outputs to their source conversation.** Provide “Open source chat” in the file detail actions.

288. **Keep a consistent file menu:** Rename, Move to project, Download, Copy link, divider, Move to Trash.

289. **Show Trash as a secondary Library destination.** Display the actual retention policy and provide Restore and Delete permanently actions.

290. **Do not erase historical conversation structure when a referenced file is deleted.** Show a clear unavailable-file placeholder while enforcing the application’s actual data-retention rules.

291. **Display storage usage only when measured.** Show the real used amount and allowance; never use decorative or fabricated progress bars.

292. **Design Plugins as a directory of supported integrations.** Use the title “Plugins,” the subtitle “Connect tools and sources to Kova,” and a search field.

293. **Use All and Connected as the primary plugin filters.** Add category filtering underneath without creating a separate page for every category.

294. **Populate the plugin directory from the approved capability catalog.** Do not add unsupported services merely because a competitor lists them.

295. **Show official plugin name, logo, one-sentence purpose, connection state, and primary action.** Use Connect, Manage, Reconnect, and Unavailable according to the real state.

296. **Keep plugin cards visually neutral.** Display the official logo inside a 40-pixel frame; do not give every provider a large brand-colored background.

297. **Open a plugin detail panel before connection.** Explain what the connection enables, required permissions, and which account will be connected.

298. **Start connection flows only after the user selects Connect.** Do not open authentication windows automatically when entering the Plugins page.

299. **Show the connected account and current permission scope in Manage.** Provide Reconnect and Disconnect without exposing credentials.

300. **Treat expired connections as a recoverable state.** Keep the existing connection record visible and explain what requires reconnection.

301. **Warn about affected workflows before disconnecting.** Identify schedules or projects that depend on the connection when this information is available.

302. **Support custom MCP configuration only through its existing supported mechanism.** Use dedicated secure fields; never ask users to paste secrets into ordinary conversation text.

303. **Do not display “Connected” until the connection is verified.** A completed authorization redirect alone must not create a false healthy state.

304. **Make Settings a real page with stable subroutes.** Use Profile, Appearance, Responses, Notifications, Connections, Privacy & security, Usage, and Billing.

305. **Use a 208-pixel settings subnavigation when the content container is at least 960 pixels wide.** Below that width, use a labeled Section selector above the content.

306. **Keep settings content within 760 pixels.** Group related settings under short headings and avoid putting every individual switch inside its own card.

307. **Use immediate saving for independent switches.** Use Save changes and Cancel for grouped text forms and sensitive account edits.

308. **Design Profile with avatar, display name, email, language, timezone, and time format.** Show immutable account fields as read-only with an explanation.

309. **Open avatar changes through Change photo.** Provide a preview and crop review before saving, plus Remove photo.

310. **Make display-name editing preserve the current value until saving succeeds.** Show field validation beside the input and maintain the prior name after failure.

311. **Keep email changes inside the existing verification flow.** Do not immediately replace the verified address just because a form was submitted.

312. **Use the account timezone for schedules and usage resets.** Display a searchable IANA timezone selector with recognizable regional descriptions.

313. **Offer 12-hour and 24-hour time formats.** Apply the preference consistently to schedules, activity, billing dates, and file metadata.

314. **Design Appearance with Theme, Accent, Density, Reading size, Reading width, and Motion.** Keep the default selections visible without opening nested dialogs.

315. **Set Theme to Dark by default.** Offer Dark, Light, and Match device settings. Save the user’s selection across devices.

316. **Offer Blue, Teal, and Slate accent presets.** Define and validate their light and dark tokens centrally; keep semantic error, warning, and success colors fixed.

317. **Offer Comfortable and Compact density.** Use 56-pixel management rows in Comfortable and 48-pixel rows in Compact; preserve usable control targets.

318. **Offer reading sizes of 16, 18, and 20 pixels.** Apply the selection to conversation prose and document bodies while preserving the interface hierarchy.

319. **Offer reading widths of 680, 760, and 900 pixels.** Default to 760 and cap each choice to the available container width.

320. **Offer Full and Reduced motion.** Always honor the device’s reduced-motion preference when it requests less motion.

321. **Add a live appearance preview.** Use one example navigation row, one answer paragraph, one content box, and one button so users can assess the actual components.

322. **Provide Reset appearance.** Restore the specified defaults without resetting response preferences or deleting data.

323. **Design Responses with default Length, Tone, Format, and custom instructions.** Explain that explicit instructions in the current chat take precedence.

324. **Show custom-instruction scope.** Identify whether instructions apply account-wide or belong to a project; do not combine the two silently.

325. **Make persistent memory opt-in and inspectable.** Show saved entries individually with Edit and Delete actions.

326. **Ask before saving a one-time correction as permanent memory.** Do not convert a temporary writing instruction into a lasting account preference.

327. **Design Notifications with separate controls for scheduled-task results, connection problems, and product announcements.** Keep promotional notifications off by default.

328. **Request browser-notification permission only after the user chooses Enable browser notifications.** Explain the browser’s denied state and how the user can change it.

329. **Keep notification sounds off by default.** Do not add a sound when a response finishes unless the user explicitly enables it.

330. **Design Privacy & security around actual account controls.** Include supported memory controls, data export, session management, account deletion, and links to current privacy information.

331. **Make temporary-chat status visible before sending.** Explain the actual storage and memory behavior using the existing policy; do not promise that nothing is retained unless that is true.

332. **Show active sessions with device information and last activity when the backend supports them.** Make “Log out other sessions” explicit and require the existing reauthentication mechanism where applicable.

333. **Keep data export asynchronous when necessary.** Show Requested, Preparing, Ready, and Failed from the actual export operation.

334. **Use a dedicated account-deletion flow.** Explain the actual consequences, preserve the ability to cancel, and require the existing identity confirmation before deletion.

335. **Design Usage with the current plan, each applicable allowance, and its reset time.** Explain which actions consume which allowance.

336. **Display measured usage separately from estimates.** Do not present a model-generated prediction as an exact remaining balance.

337. **When a limit is reached, preserve the draft.** Explain the specific limit and show the available next step without turning the entire page into an upgrade advertisement.

338. **Design Billing with Overview, Plans, and Invoices tabs.** Keep subscription management, plan comparison, and payment history reachable from this one area.

339. **Show the current subscription prominently in Overview.** Include plan name, real status, billing interval, next billing date, and the amount supplied by the billing system.

340. **Provide a clear Manage subscription button.** Open the existing supported billing-management flow and label external navigation when it occurs.

341. **Design Plans as aligned Free, Plus, and Pro cards.** Use the same feature order in every card and display the configured prices and allowances.

342. **Label the active plan “Current plan.”** Use Upgrade and Change plan for available changes; do not render every plan button as “Get started.”

343. **Preserve upgrade and downgrade timing.** Explain the actual effective date and any real proration before confirmation.

344. **Show monthly price and applicable tax wording before checkout.** Present the actual final charge through the billing provider’s supported confirmation flow.

345. **Do not invent discounts, trials, countdowns, or promo-code fields.** Render only the purchase options enabled by the existing billing configuration.

346. **Show pending cancellation with the actual access-end date.** Provide Resume subscription only when the billing system supports that action.

347. **Use Invoices to show actual invoice date, amount, status, and download link.** Do not generate substitute invoice PDFs from model-written text.

348. **Handle payment failure with a clear Update payment method action.** Keep the account’s actual entitlement state authoritative.

349. **Design login without the authenticated sidebar.** Center a 400-pixel authentication panel with the Kova logo, heading, configured sign-in methods, and form.

350. **Use the exact login heading “Log in to Kova.”** Use labeled Email and Password fields and a primary “Log in” button.

351. **Show only configured identity providers.** Do not add Apple, Microsoft, or another provider merely to make the screen look complete.

352. **Allow password managers, autofill, and pasting into credentials and verification codes.** Blocking these mechanisms can create an accessibility failure. [W3C](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html?utm_source=chatgpt.com)

353. **Provide Show password and Hide password controls.** Keep their state accessible and do not move focus away from the field when toggled.

354. **Place “Forgot password?” beside the password section.** Preserve the entered email when opening recovery.

355. **Use account-safe recovery confirmation text.** Display “If an account exists for this email, you’ll receive recovery instructions” according to the existing authentication policy.

356. **Keep signup visually identical to login.** Use the heading “Create your Kova account,” the configured fields, and the existing account requirements.

357. **Display existing terms and privacy links clearly.** Do not invent legal promises or substitute placeholder policies.

358. **Use a single paste-friendly verification-code field.** Apply the correct input purpose and show the actual resend availability from the authentication service.

359. **Preserve the original destination through authentication.** A user signing in to open a project, billing page, or shared result must return to that destination.

360. **Handle session expiration in place.** Explain that sign-in is required, preserve recoverable work according to its privacy mode, and return to the same screen after authentication.

361. **Use a mobile navigation drawer no wider than 320 pixels and no wider than the viewport minus 48 pixels.** Keep its footer and close control reachable.

362. **Make drawer navigation close after selecting a destination.** Restore focus to the new page heading or the appropriate starting control.

363. **Keep the mobile composer above the visual keyboard.** Account for browser chrome and safe areas rather than assuming a fixed screen height.

364. **Do not force the software keyboard open on every mobile page visit.** Focus the composer automatically only after an intentional typing action.

365. **Make page actions reachable without hover.** Provide visible More controls on project cards, schedules, files, and conversation rows.

366. **Support narrow layouts at 320 CSS pixels without losing ordinary content or controls.** Keep unavoidable horizontal scrolling confined to genuine two-dimensional material such as wide tables. [www.w3.org](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html?utm_source=chatgpt.com)

367. **Keep all main functionality keyboard-operable.** Use a logical focus order, a Skip to content link, and visible focus indicators.

368. **Keep focused controls unobscured by sticky elements.** Headers, drawers, and composers must not completely cover the active keyboard target. [www.w3.org](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum?utm_source=chatgpt.com)

369. **Use semantic elements.** Use buttons for actions, links for navigation, headings for document structure, and properly associated labels for fields.

370. **Announce status changes without reading every streamed token.** Provide concise accessible updates for generation start, completion, upload failure, and requests for input. [www.w3.org](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html?utm_source=chatgpt.com)

371. **Provide non-dragging controls for every draggable operation.** Include Move to project for files and explicit layout-reset controls; keyboard support alone does not replace the required pointer alternative. [W3C](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements?utm_source=chatgpt.com)

372. **Use Command-K and Control-K for global search.** Preserve standard browser Find, navigation, zoom, and new-tab shortcuts.

373. **Do not introduce global single-character shortcuts by default.** Any such shortcut must be disableable, remappable, or restricted to the relevant focused component. [W3C](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html?utm_source=chatgpt.com)

374. **Support user text-spacing overrides without clipping.** Test increased line height, paragraph spacing, letter spacing, and word spacing rather than relying on rigid text containers. [W3C](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html?trk=article-ssr-frontend-pulse_little-text-block&utm_source=chatgpt.com)

375. **Use 120-millisecond hover transitions and 180-millisecond drawer transitions.** Animate opacity and small positional changes without bouncing, overshoot, or elastic motion.

376. **Remove continuous animation from reading surfaces.** Do not animate backgrounds, shimmer completed text, or repeatedly fade paragraphs into view.

377. **Meet Core Web Vitals targets using real-user measurements:** LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1 at the 75th percentile. Evaluate mobile and desktop separately. [web.dev](https://web.dev/articles/vitals?utm_source=chatgpt.com)

378. **Measure model waiting time separately from interface speed.** Track request acceptance, first useful output, and completion without treating a fast initial page load as a fast AI experience.

379. **Load heavy editors and previews when needed.** Do not make login, the project list, and the chat composer download every document and image tool at startup.

380. **Reserve space for asynchronous content.** Upload rows, images, previews, and status panels must not unexpectedly move the control the user is about to select.

381. **Use the exact generic page-error heading “This page couldn’t load.”** Keep a Retry button and preserve navigation access instead of replacing the whole application with an error screen.

382. **Use the exact missing-page heading “This page isn’t available.”** Provide Back and Go to chat actions without exposing internal route or server details.

383. **Design a Help page with searchable documentation and the supported contact mechanism.** Do not send conversation contents to support without showing what will be included.

384. **Keep shared-result pages visually consistent but minimal.** Show the shared title, content, source disclosure where applicable, and a clear Kova identity without exposing private navigation.

385. **Make sharing private by default.** Preview the exact included content before creating a link and exclude unselected attachments and private metadata.

386. **Use frozen snapshots for ordinary share links.** Subsequent private editing must not silently alter the published snapshot.

387. **Provide a share-link management list.** Show the shared object, access setting, creation time, and Revoke action.

388. **Keep internal security and database material private.** Never include it in public previews, example data, shared snapshots, screenshots, or downloadable review packages.

389. **Test the complete UI at 390×844 and 1440×900.** Also test a narrow 320-pixel layout, a tablet layout, and an ultrawide layout.

390. **Test both themes and every saved appearance setting.** Include font-loading failure, increased text size, reduced motion, long labels, and large numbers.

391. **Test every main page in empty, loading, populated, and failed states.** Do not treat a successful screenshot of one populated desktop screen as complete coverage.

392. **Test long-content cases explicitly.** Include a 30-message conversation, a long reusable prompt, multiline code, a long project name, a long filename, and a table wider than the phone.

393. **Test data-preservation flows.** Start a draft, navigate away, return, encounter a network failure, recover, and verify that unrelated drafts remain intact.

394. **Test every destructive operation through cancellation and confirmation.** Verify that Cancel changes nothing and that confirmation affects only the intended object.

395. **Test every purchase and authentication return path in the proper test environment.** Do not create real charges or change production subscriptions merely to demonstrate the interface.

396. **Test the scheduled-task receipt specifically.** Confirm that the gray “Scheduled task created” bubble appears only after success, shows the green checkmark, and opens the correct schedule.

397. **Test copyable content boxes specifically.** Verify desktop Copy placement, mobile footer placement, exact copied content, clipboard failure, and long-code scrolling.

398. **Check the interaction inventory against the finished build.** Every visible button, menu item, switch, tab, field, card action, and link must have a working result or an explicit unavailable state with its reason.

399. **Deliver one complete reviewable application package.** Include all main pages, shared components, required assets, and a concise record of tested coverage. State genuine remaining blockers instead of calling an unfinished build complete.

400. **Finish against this acceptance rule:** Kova must retain its modern graphite visual identity across every page; navigation must remain predictable; important work must remain retrievable and editable; controls must behave consistently; and no screen may depend on decorative polish to conceal missing functionality.
