# Contract: `learning-units`

## Purpose
The `learning-units` convention establishes standard file and directory markers that identify structured learning subjects across **Polaris**, **Aurora Slides**, and **SmartDrive-OS**.

---

## Standard Markers & Folder Layout

```
<subject_workspace>/
├── 04_Roadmaps/
│   └── ROADMAP.md               # Human-readable study plan rendered in Vietnamese
├── 05_Slides/
│   └── <slug>/
│       ├── course.json          # Aurora Slides course descriptor
│       ├── 01-lesson-a/
│       │   ├── deck.json        # Lesson slide deck source
│       │   └── index.html       # Self-contained offline HTML presentation
│       └── 02-lesson-b/
│           ├── deck.json
│           └── index.html
├── polaris/
│   ├── brief.json               # Course brief and measurable outcome checks
│   ├── sources.json             # Source registry with citation locators
│   ├── facts.json               # Extracted discrete facts
│   ├── roadmap.json             # Structured roadmap JSON model
│   ├── schedule.json            # Deterministic calendar schedule
│   ├── reviews.json             # Spaced repetition tracking model
│   ├── errorlog.md              # Sổ lỗi (runtime gap journal)
│   ├── captures/                # Full-text source captures (<id>.md)
│   ├── lessons/                 # Lesson outline skeletons (<dir>.outline.md)
│   └── research/                # Investigation shortlists (<yyyy-mm-dd>-<slug>.md)
└── TASKS.md                     # Active Learning Hub task list
```

---

## SmartDrive Protection & Indexing Rules

1. **Write Protection**:
   - `course.json`, `deck.json`, and `polaris/brief.json` mark root boundaries of protected learning units.
   - SmartDrive governance tools (e.g. `ssd_clean`, `ssd_auto_organize`) MUST NOT delete, rename, or prune directories containing these markers.

2. **Index Priority**:
   - SmartDrive indexing tools (`ssd_update_index`, `ssd_search`) index `ROADMAP.md`, `errorlog.md`, and `captures/*.md` with high semantic weight.

3. **Atomic Modifications**:
   - Any agent modifying these files must write atomically and preserve formatting and line endings.
