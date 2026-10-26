"""Workspace-scoped dated notes on cost activity ("sticky notes")."""
SCHEMAS = {
    "cost_notes": """CREATE TABLE IF NOT EXISTS cost_notes (
        id TEXT PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL DEFAULT '',
        note_date TEXT NOT NULL,
        body TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'yellow',
        author_id INTEGER NOT NULL,
        author_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )""",
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_cost_notes_lookup ON cost_notes(owner_id,tenant_id,note_date)",
]

# Columns added after release. service_key identifies notes written automatically
# from an Azure Billing service (PO/BOQ); linked_service_id is an admin's manual
# "this note is explained by that PO" assignment.
MIGRATIONS = {
    "cost_notes": {
        "source": "TEXT NOT NULL DEFAULT 'manual'",
        "service_key": "TEXT NOT NULL DEFAULT ''",
        "linked_service_id": "TEXT NOT NULL DEFAULT ''",
    },
}
