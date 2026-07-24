import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AiChatMessage, ChatTopic, ChatTopicSummary, ReferenceAnalysis } from "@gold-work/shared";

interface TopicRow {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  analysis?: string | null;
}

interface MessageRow {
  id: number;
  role: AiChatMessage["role"];
  content: string;
  created_at: string;
}

export class ChatTopicRepository {
  private database?: DatabaseSync;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chat_topics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        preview TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT NOT NULL REFERENCES chat_topics(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chat_messages_topic_id ON chat_messages(topic_id, id);
    `);
    // Миграция: колонка для сохранённого разбора темы (чтобы карточка не пропадала при повторном открытии).
    const columns = this.database.prepare("PRAGMA table_info(chat_topics)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "analysis")) {
      this.database.exec("ALTER TABLE chat_topics ADD COLUMN analysis TEXT");
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  list(): ChatTopicSummary[] {
    const rows = this.db().prepare(`
      SELECT t.id, t.title, t.preview, t.created_at, t.updated_at, COUNT(m.id) AS message_count
      FROM chat_topics t
      LEFT JOIN chat_messages m ON m.topic_id = t.id
      GROUP BY t.id
      ORDER BY t.updated_at DESC
    `).all() as unknown as TopicRow[];
    return rows.map(mapSummary);
  }

  get(id: string): ChatTopic | undefined {
    const row = this.db().prepare(`
      SELECT t.id, t.title, t.preview, t.created_at, t.updated_at, t.analysis, COUNT(m.id) AS message_count
      FROM chat_topics t
      LEFT JOIN chat_messages m ON m.topic_id = t.id
      WHERE t.id = ?
      GROUP BY t.id
    `).get(id) as unknown as TopicRow | undefined;
    if (!row) return undefined;
    const messages = this.db().prepare(`
      SELECT id, role, content, created_at FROM chat_messages WHERE topic_id = ? ORDER BY id
    `).all(id) as unknown as MessageRow[];
    return {
      ...mapSummary(row),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at
      })),
      analysis: parseAnalysis(row.analysis)
    };
  }

  saveAnalysis(topicId: string, analysis: ReferenceAnalysis | null): ChatTopic {
    if (!this.get(topicId)) throw new Error("Тема чата не найдена");
    this.db().prepare("UPDATE chat_topics SET analysis = ?, updated_at = ? WHERE id = ?")
      .run(analysis ? JSON.stringify(analysis) : null, new Date().toISOString(), topicId);
    return this.get(topicId)!;
  }

  create(title = "Новая тема"): ChatTopic {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db().prepare(`
      INSERT INTO chat_topics (id, title, preview, created_at, updated_at) VALUES (?, ?, '', ?, ?)
    `).run(id, normalizeTitle(title), now, now);
    return this.get(id)!;
  }

  append(topicId: string, message: AiChatMessage): ChatTopic {
    const existing = this.get(topicId);
    if (!existing) throw new Error("Тема чата не найдена");
    const content = message.content.trim();
    if (!content) return existing;
    const now = new Date().toISOString();
    const firstUserMessage = existing.messages.every((item) => item.role !== "user");
    const title = firstUserMessage && message.role === "user" ? normalizeTitle(content) : existing.title;
    const preview = content.replace(/\s+/g, " ").slice(0, 180);
    const database = this.db();
    database.exec("BEGIN");
    try {
      database.prepare(`
        INSERT INTO chat_messages (topic_id, role, content, created_at) VALUES (?, ?, ?, ?)
      `).run(topicId, message.role, content, now);
      database.prepare(`
        UPDATE chat_topics SET title = ?, preview = ?, updated_at = ? WHERE id = ?
      `).run(title, preview, now, topicId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return this.get(topicId)!;
  }

  delete(id: string): void {
    this.db().prepare("DELETE FROM chat_topics WHERE id = ?").run(id);
  }

  private db(): DatabaseSync {
    if (!this.database) throw new Error("Хранилище тем чата не инициализировано");
    return this.database;
  }
}

function mapSummary(row: TopicRow): ChatTopicSummary {
  return {
    id: row.id,
    title: row.title,
    preview: row.preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count)
  };
}

function normalizeTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  return title.slice(0, 70) || "Новая тема";
}

function parseAnalysis(value?: string | null): ReferenceAnalysis | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ReferenceAnalysis;
  } catch {
    return undefined;
  }
}
