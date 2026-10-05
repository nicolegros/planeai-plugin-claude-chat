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
