# Claude Design prompt — Genesis UI

Paste everything below the line into Claude Design.

---

Design the complete web app UI for **Genesis**, an AI app builder for HighLevel (a CRM used by agencies and small businesses). A signed-in user connects their HighLevel account, creates a project, describes an app in chat, and watches the AI write the app's code live in an editor. A live preview beside it runs the app against their real HighLevel data (contacts, conversations, calendar appointments). They can edit the code by hand, cancel a generation, and restore any earlier version.

The people using it are technical-leaning operators: agency owners, CRM admins, solutions engineers. They spend long sessions in it. It should feel like a precise professional tool they trust with their customer data, not a toy and not a marketing site.

## The bar

Production-grade taste. It should hold up next to the best developer and productivity tools shipping today. Every screen should look intentionally designed by someone with strong opinions about restraint, hierarchy, spacing and typography. When in doubt, remove.

## Absolutely no "AI slop"

This is the most important instruction. The UI must not look AI-generated or like a generic "AI product" template. Do not use:

- Purple/blue/pink gradients, gradient text, gradient borders, or glowing gradient buttons
- Sparkle ✨ icons, magic wands, stars, "AI" badges, robot or brain icons, or anything that signals "AI magic"
- Glassmorphism, frosted blur panels, neon glows, heavy drop shadows, floating 3D blobs, orbs, mesh backgrounds, noise textures
- Emoji in the interface
- Hero-style oversized headings, marketing copy, taglines like "Build anything with AI" or "Unleash your creativity"
- Chat bubbles styled like a consumer messaging app, typing-dot animations, avatars of a friendly bot
- Rounded-everything pill soup, bouncy/playful animations, confetti, shimmering skeletons that pulse in color
- Centered-card-on-a-gradient layouts, decorative illustrations filling empty space
- Generic dashboard filler: fake stat cards, charts with no data, "Welcome back 👋"

The AI is a capability of the product, not its personality. Communicate what it is doing in plain, factual language ("Reading project", "Writing app.js", "Checking files", "Saved as version 4").

## Visual direction

- **Typography:** one clean, minimalist sans-serif for the interface and one monospace for code, paths and IDs. A tight, deliberate type scale. Hierarchy comes from weight, size and color, not decoration.
- **Theming:** subtle and mostly neutral. Near-white and near-black surfaces, soft gray borders, one restrained accent color used sparingly for primary actions and focus. Semantic colors (success, warning, error) muted, never loud. Provide both light and dark themes, equally considered.
- **Density:** comfortable but information-dense where it matters (workspace, file tree, version list). Calm, generous spacing on auth and dashboard.
- **Motion:** minimal and functional only.
- **Accessibility:** readable contrast in both themes, visible keyboard focus, no meaning carried by color alone.

The product will be built with shadcn-vue components and Tailwind, so the design should be expressible with standard primitives (buttons, inputs, dialogs, sheets, tabs, badges, dropdown menus, tooltips, toasts, resizable panels, scroll areas). Elevate them with taste; don't invent exotic widgets.

## Screens and flows to design

### 1. Sign in and sign up
- Email + password sign in; email + password + confirm sign up; link between them.
- Inline field validation, a clear error for wrong credentials, account already exists, too many attempts, and network failure.
- Submitting state on the button.
- Should feel quiet and confident, with just the product name. No hero, no illustration.

### 2. Dashboard
- App header: product name, the HighLevel connection status, user menu (email, theme toggle, sign out).
- **HighLevel connection** area with every state:
  - Not connected: explains in one line why to connect; "Connect HighLevel" primary action.
  - Connecting: the user is sent away to HighLevel and comes back.
  - Connected: shows the connected location (sub-account) name and timezone; option to disconnect (with confirmation).
  - Reconnect required: the connection expired; clear call to reconnect.
  - Returning from HighLevel: success toast, or an error toast for link expired, cancelled, agency chosen instead of a location, or HighLevel rejecting the connection.
- **Projects**: list or grid of projects showing name, description, last updated, number of files, and a warning when a project belongs to a different HighLevel location than the one connected. Actions: open, rename, delete (with confirmation).
- Create project dialog (name, optional description), and the same dialog for editing.
- States: loading, empty (first-run, with a clear way to create the first project), error with retry.

### 3. Project workspace (the core screen)
Three resizable panels side by side: **Chat**, **Code**, **Preview**. On narrow screens they become tabs.

Header: back to dashboard, project name (editable), HighLevel connection status, current generation status, a button to open version history.

**Chat panel**
- Conversation history: the user's prompts and the AI's short replies. Each AI reply notes what changed (files changed, version created) or what went wrong.
- Occasional system notes (e.g. "Restored version 3").
- Prompt input with send, a character limit indicator, and a keyboard-shortcut hint. While a generation runs the send action becomes Stop.
- Empty project: a few example prompts to start from (e.g. "Contact dashboard with search and upcoming appointments", "Conversations inbox with a message thread", "Find open slots on a calendar for the next 7 days").
- A hint when HighLevel isn't connected (generation still works; the preview won't show live data).
- **Live generation** in progress, shown in the chat:
  - Current phase in plain words: reading project → planning → writing a specific file → checking files → saving.
  - A collapsible "Planning" section showing the AI's short plan text as it streams.
  - The reply text streaming in.
  - A compact status per file being written: writing, written, rejected (with the reason on hover), deleted.
- **Outcomes** that need a decision, designed carefully:
  - Completed: normal reply, with a small note if some files were rejected.
  - Failed with nothing usable: clear reason and Retry.
  - Interrupted (connection lost) or cancelled with some finished files: "N files were completed" with **Apply**, **Discard**, **Retry**.
  - Blocked: another generation is already running (another tab), rate-limited ("try again in X"), offline.

**Code panel**
- File tree (folders, file-type cues, unsaved-changes marker, "being written" marker during generation, rejected marker).
- Editor tabs for open files, with unsaved marker and close; confirmation when closing a tab with unsaved changes.
- Code editor area (Monaco; design the frame around it: tabs, status bar, empty "select a file" state).
- Status bar: language, size, version, unsaved indicator.
- **Read-only while the AI is writing**, clearly indicated; the file currently being written can auto-focus, with a "follow along" toggle.
- Save (button and shortcut), "Saved" feedback, and a **conflict** dialog when the file changed since the user started editing (keep mine / use the latest).
- A notice when a file you're editing was updated elsewhere.

**Preview panel**
- The generated app running in a frame, labeled with the version it shows.
- Toolbar: status (live, rebuilding, waiting for first generation), reload, console toggle with an error count.
- A bottom drawer with two tabs: **Console** (logs and runtime errors from the app) and **HighLevel calls** (each call the app made: operation, duration, success or error code).
- States: no app yet; rebuilding; build problems (e.g. a missing file); HighLevel not connected (with a connect action); the app itself erroring.

### 4. Version history
- A side sheet listing versions newest first: version number, type (AI generation / checkpoint of manual edits / restore), the prompt or label, relative time with exact time on hover, number of files changed, and which version is current (plus "unsaved edits since version N" when relevant).
- Restore action with a confirmation explaining nothing is lost (current state is saved first).
- "View changes" opening a larger dialog: list of changed files (added / modified / deleted) and a side-by-side diff of the selected file, with an option to compare against the current files.
- States: loading, empty ("No versions yet"), error, restore in progress, restore disabled while generating.

### 5. Global
- **Toasts** for: connected/disconnected, project created/renamed/deleted, file saved, version restored, partial result applied, rate limits, network lost/restored, and generic failures. Distinguish success, warning and error subtly.
- **Loading states** everywhere data loads: skeletons that match the real layout; no spinning logos.
- **Error states**: page-level (project not found, page not found, app failed to load) and inline (panel failed, request failed) always with a next action.
- **Empty states**: purposeful, one line of guidance and one action; no illustrations.
- Offline banner.
- Confirmation dialogs for destructive actions (delete project, disconnect, discard unsaved changes, discard a partial result).

## Deliverables

- Every screen above in **light and dark**, at desktop width (~1440) and the workspace also at a narrow width (~390) showing the tab layout.
- The workspace shown in these moments: empty project; mid-generation (planning, then writing a file, with a rejected file); completed with preview showing real-looking contact and appointment data; interrupted with Apply/Discard/Retry; editing with unsaved changes; save conflict; preview console open with an error; HighLevel not connected.
- Dashboard in: first run (not connected, no projects), connected with projects, reconnect required, loading, error.
- Version history sheet and the diff dialog.
- A small sheet of the foundations you chose: type scale, colors for both themes, spacing, radius, component states (default, hover, focus, disabled, loading, error) and toast variants.

Use realistic content everywhere (real-looking project names, file names like `index.html`, `styles.css`, `js/api.js`, contact names, appointment times). Never lorem ipsum.
