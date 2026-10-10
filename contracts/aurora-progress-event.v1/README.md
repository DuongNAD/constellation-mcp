# Contract: `aurora-progress-event.v1`

## Purpose
The `aurora-progress-event.v1` contract defines the JSON Lines (`progress.jsonl`) data exchange format between **Aurora Slides** (the presentation and self-study runtime) and **Polaris** (the evidence-based course architect and spaced review scheduler).

Whenever a learner interacts with active recall slides (quizzes, predict-then-run terminals, memory palace walks, or deck completions), Aurora emits an event matching this specification. Polaris reads these events to update the learner's Error Log (*"Sổ lỗi"*) and calculate spaced repetition review dates (`D+1`, `D+3`, `D+7`, `D+16`, `D+35`).

---

## Event Types & Payloads

### 1. Common Base Fields
All events must contain:
- `v` (*integer*, required): Schema version (currently literal `1`).
- `t` (*string*, required): ISO 8601 timestamp (`YYYY-MM-DDTHH:mm:ssZ` or with timezone offset).
- `deck` (*string*, required): Slide deck title or folder slug.
- `slide` (*integer*, required): 0-based index of the slide.
- `type` (*string*, required): One of `"quiz" | "predict" | "recall" | "complete"`.
- `course` (*string | null*, optional): Course name or slug.
- `lesson` (*string | null*, optional): Lesson folder name.
- `slideId` (*string | null*, optional): Slide anchor ID.

---

### 2. Event: `quiz`
Emitted when a learner submits a multiple-choice question.

**Fields:**
- `question` (*string*, max 200 chars): Prompt or question text.
- `chosen` (*integer[]*): 0-based indices of the options selected by the learner.
- `chosenText` (*string[]*, optional, max 160 chars each): Option texts selected.
- `answer` (*integer[]*): 0-based indices of correct options.
- `answerText` (*string[]*, optional, max 160 chars each): Correct option texts.
- `explanation` (*string*, optional, max 300 chars): Pedagogical explanation.
- `correct` (*boolean*, required): `true` if the answer matches `answer`, `false` otherwise.

**Example:**
```json
{
  "v": 1,
  "t": "2026-10-15T14:30:00+07:00",
  "course": "ai-agents-101",
  "lesson": "01-vong-lap-agent",
  "deck": "Agent và Vòng lặp ReAct",
  "slide": 3,
  "slideId": "s_quiz_1",
  "type": "quiz",
  "question": "ReAct agent khác gì so với Chain-of-Thought tiêu chuẩn?",
  "chosen": [1],
  "chosenText": ["Chỉ suy luận bằng văn bản không tương tác môi trường"],
  "answer": [2],
  "answerText": ["Xen kẽ các bước suy luận và quan sát kết quả từ tool calling"],
  "explanation": "ReAct kết hợp Thought và Action trong cùng một vòng lặp có quan sát runtime.",
  "correct": false
}
```

---

### 3. Event: `predict`
Emitted when a learner types a prediction and evaluates the real terminal output (*predict-then-run*).

**Fields:**
- `title` (*string*, optional): Title or prompt of the exercise.
- `prediction` (*string*, max 2000 chars): Typed prediction before code execution.
- `rating` (*string*, optional): `"right" | "different" | "got" | "missed"`.
- `output` (*string*, optional, max 300 chars): Snippet of real execution output.

**Example:**
```json
{
  "v": 1,
  "t": "2026-10-15T14:35:00+07:00",
  "course": "ai-agents-101",
  "lesson": "01-vong-lap-agent",
  "deck": "Agent và Vòng lặp ReAct",
  "slide": 6,
  "slideId": "s_pred_1",
  "type": "predict",
  "title": "Dự đoán output khi regex parser gặp dấu đóng ngoặc lồng",
  "prediction": "Regex sẽ parse đúng toàn bộ biểu thức lồng nhau",
  "rating": "different",
  "output": "SyntaxError: unexpected token ')'"
}
```

---

### 4. Event: `recall`
Emitted during memory palace active recall walks.

**Fields:**
- `palace` (*string*, optional): Memory palace identifier.
- `station` (*integer*, optional): Station index (0-based).
- `place` (*string*, optional): Location in the palace route (e.g. "Cửa chính", "Bàn ăn").
- `item` (*string*, optional): Factual item or anchor placed at the station.
- `rating` (*string*, optional): `"got" | "missed"`.

**Example:**
```json
{
  "v": 1,
  "t": "2026-10-15T14:40:00+07:00",
  "course": "ai-agents-101",
  "lesson": "01-vong-lap-agent",
  "deck": "Agent và Vòng lặp ReAct",
  "slide": 10,
  "slideId": "s_palace_recall",
  "type": "recall",
  "palace": "nha-o-ha-noi",
  "station": 2,
  "place": "Sofa phòng khách",
  "item": "Vòng lặp ReAct",
  "rating": "missed"
}
```

---

### 5. Event: `complete`
Emitted once when the learner finishes reviewing the final slide of a deck.

**Fields:**
- `slides` (*integer*, optional): Total slide count.
- `quiz` (*string | null*, optional): Quiz score summary (e.g. `"4/5"`).
- `predictions` (*string | null*, optional): Prediction score summary (e.g. `"2/3"`).

**Example:**
```json
{
  "v": 1,
  "t": "2026-10-15T14:45:00+07:00",
  "course": "ai-agents-101",
  "lesson": "01-vong-lap-agent",
  "deck": "Agent và Vòng lặp ReAct",
  "slide": 15,
  "slideId": "s_summary",
  "type": "complete",
  "slides": 16,
  "quiz": "4/5",
  "predictions": "2/3"
}
```
