# Contract: `source-labels`

## Purpose
The `source-labels` convention guarantees clear distinction between verified primary curriculum content and external research extensions across **Polaris** evidence structures and **Aurora Slides** citations.

---

## Standard Labels

| Label Name (VN) | Machine Enum | Meaning & Application |
|---|---|---|
| **[Khóa học]** | `course` | Primary source of truth chosen by the learner (official lecture transcripts, primary notebooks, mandatory course materials). |
| **[Mở rộng]** | `extension` | Supplementary research discovered through Polaris discovery (OpenAlex, arXiv, Semantic Scholar, Wikipedia, YouTube). |
| **(chưa xác minh)** | `unverified` | Extracted claims containing unverified numbers, dates, or benchmark figures pending cross-checking. |

---

## Mapping between Aurora Slides and Polaris

1. **Aurora Slides `source` field**:
   - Slides derived from primary materials use: `source: "Khóa học · transcript 02:13"` or `source: "Khóa học · Lab 1 dòng 129-161"`.
   - Slides derived from research papers use: `source: "Mở rộng · arXiv:2210.03629"`.
   - Slides containing unconfirmed figures use: `source: "chưa xác minh · cần đối chiếu"`.

2. **Polaris Facts & Sources**:
   - Every fact recorded in `facts.json` has a `label` field (`"course" | "extension" | "unverified"`).
   - Core roadmap bullets cite these facts and display the Vietnamese label in `ROADMAP.md`.
