# Study practice

Study is available at `/study` and through **Practice this explanation** in Chat.
It creates bounded multiple-choice questions from an explicit goal and selected
notes, and offers foundational, standard, or advanced depth. File and image study
starts with their explanation in Chat; that explanation can then be practiced.
The existing Study chat mode supports follow-up teaching questions.

Quiz answers are checked against the generated answer key. Hints guide reasoning;
flashcards require revealing the answer before self-rating. Selection prioritizes
unseen cards, then missed or hinted cards. Scores describe practice, not a verified
qualification. Generated answers can be mistaken and can be compared with source
material. At most 20 cards and the latest 1,000 practice attempts are retained.

Generation uses the existing authenticated, metered Chat endpoint with an isolated
Temporary Chat request and no account profile, memory, or chat relationship.
Provider unavailability, quota failures, aborts, malformed output and bounded
stream errors remain failures. No generation is claimed until valid output arrives.

Saving is explicit. Signed-in users may retain up to 100 active private sets.
The server pins the expected principal, applies distributed limits, validates the
snapshot and uses an account-locked optimistic revision transaction. Unconfirmed
saves retain the exact mutation for retry; conflicts allow an explicit reload or
local export. Lists fetch metadata; bodies are fetched individually. No practice
payload is written to localStorage. Account changes and device reset clear view
state and cancel generation. Temporary Chat disables account saving and history.

Deleting a set erases its questions and answers. Minimal ID/revision/retry state
prevents delayed saves from resurrecting it. Successful writes enforce an additional
20-per-minute database limit and sweep at most 500 owner-scoped tombstones older
than 24 hours. An immutable creation token travels with every save and retry;
missing-row creation tokens older than 23 hours or more than one minute ahead are
rejected. Existing live records and exact known retries do not expire. A confirmed
expired first-save identity preserves the local practice and permits a fresh save;
old deleted generations remain confirmably absent after sweeping. Auth deletion
removes both set metadata and the database rate-limit window.
Account exports include private set data through a safe view without internal
mutation hashes. The usual account-deletion fence blocks writes during cleanup.

Imports hold the view busy while file bytes load and also fence adoption to the
captured edit revision, so a delayed import cannot erase newly recorded answers.

Local evidence: ten policy/actual-role PostgreSQL cases and six real Chromium
component cases cover answer checking, adaptive selection, bounded inputs, RLS,
revision conflicts, exact retries, deletion, account reset and Temporary Chat.
Deployment, real AI quota and authenticated cross-device production proof remain
release gates; local tests do not establish them.
