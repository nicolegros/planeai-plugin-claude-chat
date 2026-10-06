# Claude Chat

A PlaneAI plugin that drives Claude Code through the Agent SDK and renders the conversation as a chat.

## Language

### Turns and follow-ups

**Turn**:
One run of Claude from a prompt to its result, with everything it rendered in between.
_Avoid_: Exchange, round

**Follow-up**:
A message the user sends while a turn runs.
_Avoid_: Queued message, mid-turn message

**Held follow-up**:
A follow-up Claude has not consumed yet.
Once a turn ends with some held, Claude goes on to them, so the session stays busy.
_Avoid_: Pending follow-up (pending belongs to permission and question requests)

**Stamp**:
The list of user messages a turn consumed so far, carried on Claude's frames: the batch that started the turn first, then any folded in.
_Avoid_: Consumed ids, user_message_uuids

**Folded**:
Said of a follow-up Claude answers inside the running turn, without a turn of its own.
_Avoid_: Merged, absorbed

**Batch**:
Several user messages Claude takes together to start one turn.

**Follow-up tracker**:
The module that decides from Claude's frames which turn each follow-up belongs to.
_Avoid_: Queue manager

### Session status

**Session status**:
What the host shows for a session: idle while a terminal drives it, otherwise needs attention while a pending request waits on the user, busy while Claude works or owes held follow-ups a turn, otherwise idle.
It is derived from facts, never set directly.
_Avoid_: State, activity

**Pending request**:
A permission prompt or a question from Claude, waiting on the user.
_Avoid_: Prompt (that is what the user sends)

### Tool calls

**Tool input**:
What the chat renders of a tool call, as one kind per way of showing it, such as a command, an edit or a search.
The sidecar reads it from Claude's input, and the UI shows a tool by the kind of its tool input.
_Avoid_: Tool args, params

**Summary**:
One line about a tool call's input, kept so a tool without a tool input still shows something.
The UI shows it as it is and never reads fields out of it.

### Chat UI

**Chat session**:
The chat UI's side of one PlaneAI session: its transcript, its status and the user's actions, through the host.
_Avoid_: Controller, store
