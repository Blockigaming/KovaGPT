# KovaGPT P0 UI Gap Audit

> Source-risk audit only. This does not declare runtime completion.

| Rank | Surface                       | Risk | Missing files | Unfinished markers | Loading | Error | Auth |
| ---: | ----------------------------- | ---: | ------------: | -----------------: | ------: | ----: | ---: |
|    1 | Project workspace             |   57 |             0 |                  6 |      28 |    34 |    6 |
|    2 | Memory                        |   49 |             0 |                  2 |      13 |   112 |   23 |
|    3 | Apps / connectors             |   44 |             0 |                  1 |      11 |   145 |   32 |
|    4 | Settings                      |   38 |             0 |                  1 |       9 |    97 |   18 |
|    5 | Work / long-running execution |   27 |             0 |                  0 |      12 |    38 |    0 |
|    6 | Sharing                       |   22 |             0 |                  2 |      11 |    20 |    0 |
|    7 | Core chat                     |   21 |             0 |                  0 |      46 |    99 |   38 |
|    8 | Data analysis                 |   21 |             0 |                  0 |      38 |    84 |   32 |
|    9 | Deep Research                 |   21 |             0 |                  0 |      10 |    57 |    7 |
|   10 | Scheduled Tasks               |   18 |             0 |                  0 |      10 |    48 |    5 |
|   11 | Conversation search/history   |   16 |             0 |                  0 |       0 |     0 |    8 |
|   12 | Study mode                    |   15 |             0 |                  0 |       7 |    36 |    2 |
|   13 | Authentication                |   12 |             0 |                  0 |      45 |    95 |   12 |
|   14 | Terms                         |   12 |             0 |                  1 |       0 |     0 |    0 |
|   15 | Canvas / artifacts            |    9 |             0 |                  0 |       1 |    36 |   11 |
|   16 | Projects                      |    9 |             0 |                  0 |      10 |    39 |    7 |
|   17 | Temporary Chat                |    9 |             0 |                  0 |      34 |    63 |   42 |
|   18 | Custom assistants / Kovas     |    7 |             0 |                  0 |       0 |     0 |    0 |
|   19 | Images                        |    6 |             0 |                  0 |       8 |    32 |   13 |
|   20 | Billing return/recovery       |    4 |             0 |                  0 |       0 |     0 |    0 |
|   21 | Pricing / plans               |    4 |             0 |                  0 |       0 |     0 |    2 |
|   22 | Files                         |    3 |             0 |                  0 |       4 |     6 |    5 |
|   23 | Library                       |    3 |             0 |                  0 |      21 |    20 |    9 |
|   24 | Project conversation          |    3 |             0 |                  0 |       7 |    36 |    6 |
|   25 | Assistant detail              |    2 |             0 |                  0 |       0 |     1 |    0 |
|   26 | Privacy                       |    2 |             0 |                  0 |       0 |     2 |    0 |
|   27 | Password recovery             |    0 |             0 |                  0 |       3 |    20 |    0 |

## Explicit risk markers

### Project workspace

- `src/routes/projects.$projectId.tsx:955` — placeholder={
- `src/routes/projects.$projectId.tsx:1054` — placeholder={canEdit ? "Start writing shared notes for the team…" : "No notes yet."}
- `src/routes/projects.$projectId.tsx:1109` — const next = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo";
- `src/routes/projects.$projectId.tsx:1132` — todo: tasks.filter((t) => t.status === "todo"),
- `src/routes/projects.$projectId.tsx:1154` — placeholder="New task…"
- `src/routes/projects.$projectId.tsx:1186` — {(["todo", "doing", "done"] as const).map((k) => (
- `src/routes/projects.$projectId.tsx:1189` — {k === "todo" ? "To do" : k === "doing" ? "In progress" : "Done"} ·{" "}
- `src/routes/projects.$projectId.tsx:1311` — placeholder="e.g. Our brand voice is warm and concise."
- `src/routes/projects.$projectId.tsx:1427` — placeholder="Search chats, notes, tasks, files, memory…"
- `src/routes/projects.$projectId.tsx:1514` — placeholder="teammate@example.com"
- `src/routes/projects.$projectId.tsx:1647` — placeholder="Persistent instructions added to every chat in this project (e.g. brand voice, product details)."

### Memory

- `src/routes/memory.tsx:125` — placeholder="Search memories"
- `src/routes/memory.tsx:296` — Relevant saved context may be included with a future prompt. Retrieved connector data is
- `src/components/SettingsDialog.tsx:772` — placeholder={user?.firstName || "Your name"}
- `src/components/SettingsDialog.tsx:783` — placeholder="e.g. I'm a student in Chicago. I prefer metric. I'm learning Python."
- `src/components/SettingsDialog.tsx:820` — placeholder="e.g. Answer in clear bullets. Use simple language. Skip disclaimers."
- `src/components/SettingsDialog.tsx:923` — integrations work today; others are on the roadmap.
- `src/components/SettingsDialog.tsx:1651` — placeholder="Type DELETE"
- `src/components/SettingsDialog.tsx:2188` — placeholder="Search title or content..."
- `src/components/SettingsDialog.tsx:2788` — placeholder="New PIN (4-8 digits)"
- `src/components/SettingsDialog.tsx:2796` — placeholder="Confirm PIN"
- `src/components/SettingsDialog.tsx:2812` — placeholder="Current PIN"
- `src/components/SettingsDialog.tsx:2820` — placeholder="New PIN"
- `src/components/SettingsDialog.tsx:2828` — placeholder="Confirm new PIN"

### Apps / connectors

- `src/routes/apps.tsx:524` — placeholder="Search GitHub repositories"
- `src/routes/apps.tsx:938` — placeholder="Search apps"
- `src/components/SettingsDialog.tsx:772` — placeholder={user?.firstName || "Your name"}
- `src/components/SettingsDialog.tsx:783` — placeholder="e.g. I'm a student in Chicago. I prefer metric. I'm learning Python."
- `src/components/SettingsDialog.tsx:820` — placeholder="e.g. Answer in clear bullets. Use simple language. Skip disclaimers."
- `src/components/SettingsDialog.tsx:923` — integrations work today; others are on the roadmap.
- `src/components/SettingsDialog.tsx:1651` — placeholder="Type DELETE"
- `src/components/SettingsDialog.tsx:2188` — placeholder="Search title or content..."
- `src/components/SettingsDialog.tsx:2788` — placeholder="New PIN (4-8 digits)"
- `src/components/SettingsDialog.tsx:2796` — placeholder="Confirm PIN"
- `src/components/SettingsDialog.tsx:2812` — placeholder="Current PIN"
- `src/components/SettingsDialog.tsx:2820` — placeholder="New PIN"
- `src/components/SettingsDialog.tsx:2828` — placeholder="Confirm new PIN"

### Settings

- `src/components/SettingsDialog.tsx:772` — placeholder={user?.firstName || "Your name"}
- `src/components/SettingsDialog.tsx:783` — placeholder="e.g. I'm a student in Chicago. I prefer metric. I'm learning Python."
- `src/components/SettingsDialog.tsx:820` — placeholder="e.g. Answer in clear bullets. Use simple language. Skip disclaimers."
- `src/components/SettingsDialog.tsx:923` — integrations work today; others are on the roadmap.
- `src/components/SettingsDialog.tsx:1651` — placeholder="Type DELETE"
- `src/components/SettingsDialog.tsx:2188` — placeholder="Search title or content..."
- `src/components/SettingsDialog.tsx:2788` — placeholder="New PIN (4-8 digits)"
- `src/components/SettingsDialog.tsx:2796` — placeholder="Confirm PIN"
- `src/components/SettingsDialog.tsx:2812` — placeholder="Current PIN"
- `src/components/SettingsDialog.tsx:2820` — placeholder="New PIN"
- `src/components/SettingsDialog.tsx:2828` — placeholder="Confirm new PIN"

### Work / long-running execution

- `src/routes/work.tsx:586` — placeholder="Search evidence"
- `src/routes/work.tsx:720` — placeholder="Search deliverables"
- `src/components/AgentWorkspace.tsx:239` — placeholder="Agent name"
- `src/components/AgentWorkspace.tsx:246` — placeholder="Project (optional)"
- `src/components/AgentWorkspace.tsx:253` — placeholder="What should this agent accomplish?"
- `src/components/AgentWorkspace.tsx:260` — placeholder="Guardrails and output requirements"
- `src/components/AgentWorkspace.tsx:267` — placeholder={
- `src/components/AgentTeamWorkspace.tsx:213` — placeholder="What should your team accomplish?"
- `src/components/AgentTeamWorkspace.tsx:220` — placeholder="Project ID (optional)"

### Sharing

- `src/components/ShareChatDialog.tsx:93` — placeholder="friend@example.com"
- `src/components/ShareChatDialog.tsx:101` — included. Future replies in your chat won't update theirs.
- `src/components/ProjectCollaboration.tsx:75` — opens and are ready for a future realtime subscription.
- `src/components/ProjectCollaboration.tsx:95` — placeholder="Add a project comment or inline note…"

### Core chat

- `src/routes/index.tsx:1714` — placeholder="Ask anything"
- `src/routes/index.tsx:2023` — placeholder="Ask anything"
- `src/components/ChatInput.tsx:103` — placeholder,
- `src/components/ChatInput.tsx:134` — placeholder?: string;
- `src/components/ChatInput.tsx:520` — placeholder="Search files"
- `src/components/ChatInput.tsx:918` — placeholder={placeholder ?? "Ask anything"}

### Data analysis

- `src/components/ChatInput.tsx:103` — placeholder,
- `src/components/ChatInput.tsx:134` — placeholder?: string;
- `src/components/ChatInput.tsx:520` — placeholder="Search files"
- `src/components/ChatInput.tsx:918` — placeholder={placeholder ?? "Ask anything"}
- `src/routes/index.tsx:1714` — placeholder="Ask anything"
- `src/routes/index.tsx:2023` — placeholder="Ask anything"

### Deep Research

- `src/routes/research-planner.tsx:249` — placeholder="What should KovaGPT investigate?"
- `src/routes/research-planner.tsx:283` — placeholder="Website allow list, one domain per line (optional)"
- `src/components/ChatInput.tsx:103` — placeholder,
- `src/components/ChatInput.tsx:134` — placeholder?: string;
- `src/components/ChatInput.tsx:520` — placeholder="Search files"
- `src/components/ChatInput.tsx:918` — placeholder={placeholder ?? "Ask anything"}

### Scheduled Tasks

- `src/routes/scheduled-tasks.tsx:434` — placeholder="Morning market summary"
- `src/routes/scheduled-tasks.tsx:448` — placeholder="Summarize the top 5 AI news stories from the last 24 hours."
- `src/routes/scheduled-tasks.tsx:518` — placeholder="Search tasks"
- `src/components/AutomationBuilder.tsx:93` — placeholder="Weekly project briefing"
- `src/components/AutomationBuilder.tsx:103` — placeholder="Summarize the progress and open questions in my project notes."
- `src/components/AutomationBuilder.tsx:113` — placeholder="there are new notes since the prior run"

### Conversation search/history

- `src/components/Sidebar.tsx:460` — placeholder="Search titles, messages, or operators…"
- `src/components/CommandPalette.tsx:477` — placeholder="Search chats, apps, files, and actions"
- `src/components/CommandPalette.tsx:483` — className="h-10 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
- `src/components/ArchivedChatsDialog.tsx:97` — placeholder="Search titles or message content"

### Study mode

- `src/components/ChatInput.tsx:103` — placeholder,
- `src/components/ChatInput.tsx:134` — placeholder?: string;
- `src/components/ChatInput.tsx:520` — placeholder="Search files"
- `src/components/ChatInput.tsx:918` — placeholder={placeholder ?? "Ask anything"}

### Authentication

- `src/routes/auth.tsx:221` — placeholder="Email address"
- `src/routes/auth.tsx:242` — placeholder="Your name (optional)"
- `src/routes/auth.tsx:255` — placeholder="Password"
- `src/components/auth/AuthDialog.tsx:208` — placeholder="Email address"

### Terms

- `src/routes/terms.tsx:68` — from your account settings; canceling stops future renewals but your current plan may

### Canvas / artifacts

- `src/components/ArtifactEditor.tsx:443` — placeholder="Find heading"
- `src/components/ArtifactEditor.tsx:603` — placeholder="Comment on the document or current selection"
- `src/components/SelectionEditDialog.tsx:259` — placeholder="Make it shorter and less formal"

### Projects

- `src/routes/projects.tsx:621` — placeholder="Search projects"
- `src/routes/projects.tsx:788` — placeholder="Marketing campaign"
- `src/routes/projects.tsx:798` — placeholder="What's this project about?"

### Temporary Chat

- `src/routes/index.tsx:1714` — placeholder="Ask anything"
- `src/routes/index.tsx:2023` — placeholder="Ask anything"
- `src/components/ChatWorkspaceDialog.tsx:235` — placeholder="Always answer in British English and keep responses under 150 words."

### Custom assistants / Kovas

- `src/routes/assistants.tsx:45` — placeholder="Search assistants"

### Images

- `src/routes/images.tsx:573` — placeholder="Describe a new image"
- `src/routes/images.tsx:576` — className="min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"

### Files

- `src/routes/files.tsx:92` — placeholder="Search files"

### Library

- `src/routes/library.tsx:678` — placeholder="Search Library"

### Project conversation

- `src/routes/projects.$projectId.chat.$chatId.tsx:448` — placeholder={canEdit ? "Message the project…" : "You have view-only access"}
