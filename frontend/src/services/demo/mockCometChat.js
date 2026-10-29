// Offline stand-in for the CometChat SDK, used when VITE_DEMO_MODE=true.
// It implements only the parts of the SDK this app calls, with the same names,
// so services/cometchat.js can swap it in without touching hooks or components.
//
// - Data lives in localStorage, so every tab sees the same messages.
// - Live events travel between tabs through localStorage "storage" events (the
//   stand-in for CometChat's WebSocket). Storage events arrive in write order,
//   so a tab never hears about a change before the data itself has synced.
//   Log in as different users in two tabs to chat.
// - Nancy, Susan and John are bots: they read your message, type, then reply.

const RECEIVER_TYPE = { USER: "user", GROUP: "group" };
const MESSAGE_TYPE = { TEXT: "text", IMAGE: "image", FILE: "file" };
const GROUP_TYPE = { PUBLIC: "public", PRIVATE: "private", PASSWORD: "password" };
const GROUP_MEMBER_SCOPE = { ADMIN: "admin", MODERATOR: "moderator", PARTICIPANT: "participant" };
const REACTION_ACTION = { REACTION_ADDED: "message_reaction_added", REACTION_REMOVED: "message_reaction_removed" };

const USERS = [
  { uid: "cometchat-uid-1", name: "Andrew Joseph" },
  { uid: "cometchat-uid-2", name: "George Alan" },
  { uid: "cometchat-uid-3", name: "Nancy Grace", bot: true },
  { uid: "cometchat-uid-4", name: "Susan Marie", bot: true },
  { uid: "cometchat-uid-5", name: "John Paul", bot: true },
];
const BOTS = USERS.filter((u) => u.bot);

// Built-in sample users plus anyone who signed up through the backend (`npm run demo:auth`).
const allUsers = (db = loadDb()) => [...USERS, ...(db.users ?? [])];
const findUser = (uid, db) => allUsers(db).find((u) => u.uid === uid);

const DB_KEY = "demo-cometchat-db-v2";
const PRESENCE_KEY = "demo-cometchat-presence";
const EVENT_KEY = "demo-cometchat-event";
const SESSION_KEY = "demo-cometchat-uid"; // sessionStorage: one user per tab
const ONLINE_WINDOW_MS = 15000;
const MAX_FILE_BYTES = 3 * 1024 * 1024; // files are stored in localStorage

const nowSec = () => Math.floor(Date.now() / 1000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fail = (code, message) => {
  throw { code, message };
};

// ---------------------------------------------------------------- storage

function seedDb() {
  const t = nowSec();
  const raw = [
    ["cometchat-uid-3", "cometchat-uid-1", "user", "Hey Andrew! Welcome to the CometChat demo 👋", -90000],
    ["cometchat-uid-1", "cometchat-uid-3", "user", "Thanks Nancy! Just testing things out.", -89900],
    ["cometchat-uid-3", "cometchat-uid-1", "user", "Send me a message and I'll reply. Try a second tab too!", -7000],
    ["cometchat-uid-4", "team-howl", "group", "Morning team! Standup in 10 minutes.", -3600],
    ["cometchat-uid-5", "team-howl", "group", "On my way ☕", -3500],
    ["cometchat-uid-2", "team-howl", "group", "Can someone share the sprint board link?", -3400],
    ["cometchat-uid-3", "design-crew", "group", "Welcome to Design Crew! Share your mockups here 🎨", -2000],
    ["cometchat-uid-2", "cometchat-uid-1", "user", "Andrew, are you free for a quick review later?", -600],
  ];
  const messages = raw.map(([senderUid, receiverId, receiverType, text, offset], i) => ({
    id: i + 1,
    senderUid,
    receiverId,
    receiverType,
    type: "text",
    text,
    sentAt: t + offset,
    deliveredAt: t + offset + 1,
    readAt: i <= 1 ? t + offset + 30 : null,
    reactions: i === 4 ? { "👍": ["cometchat-uid-4"] } : {},
  }));
  return {
    nextId: messages.length + 1,
    messages,
    lastRead: { "cometchat-uid-1": { "user:cometchat-uid-3": 2 } },
    groups: [
      { guid: "team-howl", name: "Team Howl", type: GROUP_TYPE.PUBLIC, owner: "cometchat-uid-4" },
      { guid: "design-crew", name: "Design Crew", type: GROUP_TYPE.PUBLIC, owner: "cometchat-uid-3" },
    ],
    members: {
      "team-howl": {
        "cometchat-uid-4": GROUP_MEMBER_SCOPE.ADMIN,
        "cometchat-uid-1": GROUP_MEMBER_SCOPE.ADMIN,
        "cometchat-uid-2": GROUP_MEMBER_SCOPE.PARTICIPANT,
        "cometchat-uid-3": GROUP_MEMBER_SCOPE.PARTICIPANT,
        "cometchat-uid-5": GROUP_MEMBER_SCOPE.PARTICIPANT,
      },
      "design-crew": {
        "cometchat-uid-3": GROUP_MEMBER_SCOPE.ADMIN,
        "cometchat-uid-5": GROUP_MEMBER_SCOPE.PARTICIPANT,
      },
    },
    users: [], // accounts created through the backend
    blocked: {}, // uid -> [uids they blocked]
    cleared: {}, // uid -> { chatKey: last cleared message id }
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to a fresh seed
  }
  const db = seedDb();
  saveDb(db);
  return db;
}

function saveDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    fail("ERR_STORAGE_FULL", "Demo storage is full. Clear site data to reset the demo.");
  }
}

function updateDb(fn) {
  const db = loadDb();
  const result = fn(db);
  saveDb(db);
  return result;
}

const currentUid = () => sessionStorage.getItem(SESSION_KEY);

function requireMe() {
  const uid = currentUid();
  if (!uid) fail("USER_NOT_LOGGED_IN", "Not logged in");
  return uid;
}

const isMember = (db, guid, uid) => Boolean(db.members[guid]?.[uid]);
const findRecord = (db, id) => db.messages.find((r) => String(r.id) === String(id));

// Which chat a stored message belongs to, from `me`'s point of view.
function convKey(record, me) {
  if (record.receiverType === RECEIVER_TYPE.GROUP) return `group:${record.receiverId}`;
  const other = record.senderUid === me ? record.receiverId : record.senderUid;
  return `user:${other}`;
}

function isVisibleTo(db, record, me) {
  if (record.receiverType === RECEIVER_TYPE.GROUP) return isMember(db, record.receiverId, me);
  if (record.senderUid !== me && record.receiverId !== me) return false;
  return record.id > (db.cleared[me]?.[convKey(record, me)] ?? 0);
}

// ---------------------------------------------------------------- presence

function readPresence() {
  try {
    return JSON.parse(localStorage.getItem(PRESENCE_KEY)) || {};
  } catch {
    return {};
  }
}

function writePresence(uid, online) {
  const presence = readPresence();
  if (online) presence[uid] = Date.now();
  else delete presence[uid];
  localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence));
}

function statusOf(uid) {
  if (BOTS.some((b) => b.uid === uid)) return "online";
  const lastSeen = readPresence()[uid];
  return lastSeen && Date.now() - lastSeen < ONLINE_WINDOW_MS ? "online" : "offline";
}

let heartbeat = null;

function goOnline(uid) {
  writePresence(uid, true);
  clearInterval(heartbeat);
  heartbeat = setInterval(() => writePresence(uid, true), 5000);
  emit({ kind: "presence", uid, status: "online" });
}

function goOffline(uid) {
  clearInterval(heartbeat);
  writePresence(uid, false);
  emit({ kind: "presence", uid, status: "offline" });
}

// ---------------------------------------------------------------- SDK-shaped classes

class User {
  constructor(uid, name, status) {
    this.uid = uid;
    this.name = name;
    this.status = status;
  }
  getUid() { return this.uid; }
  getName() { return this.name; }
  getAvatar() { return undefined; }
  getStatus() { return this.status; }
  getBlockedByMe() { return Boolean(this.blockedByMe); }
  getHasBlockedMe() { return Boolean(this.hasBlockedMe); }
}

class GroupMember extends User {
  constructor(uid, scope) {
    super(uid, findUser(uid)?.name ?? uid, statusOf(uid));
    this.scope = scope;
  }
  getScope() { return this.scope; }
}

class Group {
  constructor(guid, name, type = GROUP_TYPE.PUBLIC) {
    this.guid = guid;
    this.name = name;
    this.type = type;
  }
  getGuid() { return this.guid; }
  getName() { return this.name; }
  getIcon() { return undefined; }
  getType() { return this.type; }
  getHasJoined() { return Boolean(this.hasJoined); }
  getMembersCount() { return this.membersCount ?? 0; }
  getScope() { return this.scope; }
  getOwner() { return this.owner; }
}

function makeUser(uid, db = loadDb()) {
  const user = findUser(uid, db);
  const result = new User(uid, user?.name ?? uid, statusOf(uid));
  const me = currentUid();
  if (me && me !== uid) {
    result.blockedByMe = (db.blocked[me] ?? []).includes(uid);
    result.hasBlockedMe = (db.blocked[uid] ?? []).includes(me);
  }
  return result;
}

function makeGroup(guid, db = loadDb()) {
  const stored = db.groups.find((g) => g.guid === guid);
  if (!stored) return null;
  const group = new Group(guid, stored.name, stored.type);
  const me = currentUid();
  const members = db.members[guid] ?? {};
  group.hasJoined = Boolean(members[me]);
  group.membersCount = Object.keys(members).length;
  group.scope = members[me];
  group.owner = stored.owner;
  return group;
}

class Attachment {
  constructor(data) { Object.assign(this, data); }
  getName() { return this.name; }
  getUrl() { return this.url; }
  getMimeType() { return this.mimeType; }
  getSize() { return this.size; }
  getExtension() { return this.extension; }
}

class ReactionCount {
  constructor(reaction, count, reactedByMe) {
    this.reaction = reaction;
    this.count = count;
    this.reactedByMe = reactedByMe;
  }
  getReaction() { return this.reaction; }
  getCount() { return this.count; }
  getReactedByMe() { return this.reactedByMe; }
}

class BaseMessage {
  constructor(receiverId, receiverType) {
    this.receiverId = receiverId;
    this.receiverType = receiverType;
  }
  getId() { return this.id; }
  setId(id) { this.id = id; }
  getSender() { return this.sender; }
  getReceiverId() { return this.receiverId; }
  getReceiverType() { return this.receiverType; }
  getSentAt() { return this.sentAt; }
  getType() { return this.type; }
  getCategory() { return "message"; }
  getDeletedAt() { return this.deletedAt; }
  getDeliveredAt() { return this.deliveredAt; }
  getReadAt() { return this.readAt; }
  getEditedAt() { return this.editedAt; }
  getMetadata() { return this.metadata; }
  setMetadata(metadata) { this.metadata = metadata; }
  getQuotedMessageId() { return this.quotedMessageId; }
  setQuotedMessageId(id) { this.quotedMessageId = id; }
  getQuotedMessage() {
    if (!this.quotedMessageId) return null;
    const record = findRecord(loadDb(), this.quotedMessageId);
    return record ? fromRecord(record) : null;
  }
  getReactions() {
    const me = currentUid();
    return Object.entries(this.reactionMap ?? {})
      .filter(([, uids]) => uids.length)
      .map(([emoji, uids]) => new ReactionCount(emoji, uids.length, uids.includes(me)));
  }
}

class TextMessage extends BaseMessage {
  constructor(receiverId, text, receiverType) {
    super(receiverId, receiverType);
    this.type = MESSAGE_TYPE.TEXT;
    this.text = text;
  }
  getText() { return this.text; }
}

class MediaMessage extends BaseMessage {
  constructor(receiverId, file, type, receiverType) {
    super(receiverId, receiverType);
    this.file = file;
    this.type = type;
  }
  getAttachment() { return this.attachment ? new Attachment(this.attachment) : null; }
  getURL() { return this.attachment?.url; }
}

function fromRecord(record) {
  const db = loadDb();
  const message =
    record.type === MESSAGE_TYPE.TEXT
      ? new TextMessage(record.receiverId, record.text, record.receiverType)
      : new MediaMessage(record.receiverId, null, record.type, record.receiverType);
  Object.assign(message, {
    id: record.id,
    sender: makeUser(record.senderUid, db),
    sentAt: record.sentAt,
    deliveredAt: record.deliveredAt,
    readAt: record.readAt,
    editedAt: record.editedAt,
    deletedAt: record.deletedAt,
    quotedMessageId: record.quotedMessageId,
    reactionMap: record.reactions ?? {},
    attachment: record.attachment,
  });
  return message;
}

class TypingIndicator {
  constructor(receiverId, receiverType) {
    this.receiverId = receiverId;
    this.receiverType = receiverType;
  }
  getSender() { return this.sender; }
  getReceiverId() { return this.receiverId; }
  getReceiverType() { return this.receiverType; }
}

class MessageReceipt {
  constructor(messageId, reader, receiverType, receiver) {
    this.messageId = messageId;
    this.reader = reader;
    this.receiverType = receiverType;
    this.receiver = receiver;
  }
  getMessageId() { return this.messageId; }
  getSender() { return this.reader; }
  getReceiverType() { return this.receiverType; }
  getReceiver() { return this.receiver; }
}

class Reaction {
  constructor(messageId, reaction, uid) {
    this.messageId = messageId;
    this.reaction = reaction;
    this.uid = uid;
  }
  getMessageId() { return this.messageId; }
  getReaction() { return this.reaction; }
  getUid() { return this.uid; }
  getReactedBy() { return makeUser(this.uid); }
}

class ReactionEvent {
  constructor(reaction, receiverId, receiverType) {
    this.reaction = reaction;
    this.receiverId = receiverId;
    this.receiverType = receiverType;
  }
  getReaction() { return this.reaction; }
  getReceiverId() { return this.receiverId; }
  getReceiverType() { return this.receiverType; }
}

class Conversation {
  constructor(conversationWith, lastMessage, unread) {
    this.conversationWith = conversationWith;
    this.lastMessage = lastMessage;
    this.unread = unread;
  }
  getConversationWith() { return this.conversationWith; }
  getLastMessage() { return this.lastMessage; }
  getUnreadMessageCount() { return this.unread; }
}

class Listener {
  constructor(handlers) { Object.assign(this, handlers); }
}
class MessageListener extends Listener {}
class UserListener extends Listener {}
class GroupListener extends Listener {}
class ConnectionListener extends Listener {}

class AppSettingsBuilder {
  subscribePresenceForAllUsers() { return this; }
  setRegion() { return this; }
  autoEstablishSocketConnection() { return this; }
  build() { return {}; }
}

const CometChatHelper = {
  // The demo store already holds the new reactions, so just re-read the message.
  updateMessageWithReactionInfo(message) {
    const record = findRecord(loadDb(), message.getId());
    return record ? fromRecord(record) : message;
  },
};

// ---------------------------------------------------------------- requests

// Returns one page per fetchNext() call from a list computed on demand.
function pager(limit, compute) {
  let offset = 0;
  return {
    async fetchNext() {
      await delay(150);
      const page = compute().slice(offset, offset + limit);
      offset += page.length;
      return page;
    },
  };
}

const matches = (name, keyword) => !keyword || name.toLowerCase().includes(keyword.toLowerCase());

class ConversationsRequestBuilder {
  setLimit(limit) { this.limit = limit; return this; }
  build() {
    return pager(this.limit ?? 30, () => {
      const me = requireMe();
      const db = loadDb();
      const latest = new Map();
      for (const record of db.messages) {
        if (!isVisibleTo(db, record, me)) continue;
        const key = convKey(record, me);
        if (!latest.has(key) || latest.get(key).id < record.id) latest.set(key, record);
      }
      const lastRead = db.lastRead[me] ?? {};
      return [...latest.entries()]
        .sort((a, b) => b[1].id - a[1].id)
        .map(([key, record]) => {
          const id = key.slice(key.indexOf(":") + 1);
          const unread = db.messages.filter(
            (r) =>
              r.senderUid !== me &&
              !r.deletedAt &&
              r.id > (lastRead[key] ?? 0) &&
              isVisibleTo(db, r, me) &&
              convKey(r, me) === key,
          ).length;
          const withEntity = record.receiverType === RECEIVER_TYPE.GROUP ? makeGroup(id, db) : makeUser(id, db);
          return new Conversation(withEntity, fromRecord(record), unread);
        });
    });
  }
}

class UsersRequestBuilder {
  setLimit(limit) { this.limit = limit; return this; }
  setSearchKeyword(keyword) { this.keyword = keyword; return this; }
  build() {
    const { keyword } = this;
    return pager(this.limit ?? 30, () => {
      const db = loadDb();
      return allUsers(db)
        .filter((u) => matches(u.name, keyword))
        .map((u) => makeUser(u.uid, db));
    });
  }
}

class GroupsRequestBuilder {
  setLimit(limit) { this.limit = limit; return this; }
  setSearchKeyword(keyword) { this.keyword = keyword; return this; }
  joinedOnly(value) { this.joined = value; return this; }
  build() {
    const { keyword, joined } = this;
    return pager(this.limit ?? 30, () => {
      const me = requireMe();
      const db = loadDb();
      return db.groups
        .filter((g) => matches(g.name, keyword))
        .filter((g) => (joined ? isMember(db, g.guid, me) : g.type === GROUP_TYPE.PUBLIC || isMember(db, g.guid, me)))
        .map((g) => makeGroup(g.guid, db));
    });
  }
}

class GroupMembersRequestBuilder {
  constructor(guid) { this.guid = guid; }
  setLimit(limit) { this.limit = limit; return this; }
  build() {
    const { guid } = this;
    return pager(this.limit ?? 30, () =>
      Object.entries(loadDb().members[guid] ?? {}).map(([uid, scope]) => new GroupMember(uid, scope)),
    );
  }
}

class MessagesRequestBuilder {
  setLimit(limit) { this.limit = limit; return this; }
  setCategories() { return this; }
  setUID(uid) { this.key = `user:${uid}`; return this; }
  setGUID(guid) { this.key = `group:${guid}`; return this; }
  build() {
    const { key } = this;
    const limit = this.limit ?? 30;
    let cursor = Infinity; // fetchPrevious pages backwards from here
    return {
      async fetchPrevious() {
        await delay(150);
        const me = requireMe();
        const db = loadDb();
        const page = db.messages
          .filter((r) => r.id < cursor && isVisibleTo(db, r, me) && convKey(r, me) === key)
          .sort((a, b) => a.id - b.id)
          .slice(-limit);
        if (page.length) cursor = page[0].id;
        return page.map(fromRecord);
      },
    };
  }
}

// ---------------------------------------------------------------- live events

const listeners = { message: new Map(), user: new Map(), group: new Map(), connection: new Map() };
let initialized = false;

const call = (kind, name, ...args) => [...listeners[kind].values()].forEach((l) => l[name]?.(...args));

// Decides whether an event concerns the user logged in to *this* tab.
function handleEvent(event) {
  const me = currentUid();
  if (!me) return;
  const db = loadDb();
  switch (event.kind) {
    case "message":
    case "edited":
    case "deleted": {
      const record = findRecord(db, event.id);
      if (!record || event.actorUid === me || !isVisibleTo(db, record, me)) return;
      const name = { message: "onTextMessageReceived", edited: "onMessageEdited", deleted: "onMessageDeleted" }[
        event.kind
      ];
      const handler = event.kind === "message" && record.type !== MESSAGE_TYPE.TEXT ? "onMediaMessageReceived" : name;
      call("message", handler, fromRecord(record));
      break;
    }
    case "reaction": {
      const record = findRecord(db, event.messageId);
      if (!record || event.uid === me || !isVisibleTo(db, record, me)) return;
      const reactionEvent = new ReactionEvent(
        new Reaction(event.messageId, event.emoji, event.uid),
        record.receiverId,
        record.receiverType,
      );
      call("message", event.added ? "onMessageReactionAdded" : "onMessageReactionRemoved", reactionEvent);
      break;
    }
    case "typing": {
      if (event.senderUid === me) return;
      if (event.receiverType === RECEIVER_TYPE.USER && event.receiverId !== me) return;
      if (event.receiverType === RECEIVER_TYPE.GROUP && !isMember(db, event.receiverId, me)) return;
      const indicator = new TypingIndicator(event.receiverId, event.receiverType);
      indicator.sender = makeUser(event.senderUid, db);
      call("message", event.started ? "onTypingStarted" : "onTypingEnded", indicator);
      break;
    }
    case "receipt": {
      if (event.targetUid !== me) return;
      const receipt = new MessageReceipt(
        event.messageId,
        makeUser(event.readerUid, db),
        event.receiverType,
        event.receiverId,
      );
      const names = {
        read: "onMessagesRead",
        delivered: "onMessagesDelivered",
        readByAll: "onMessagesReadByAll",
        deliveredToAll: "onMessagesDeliveredToAll",
      };
      call("message", names[event.field], receipt);
      break;
    }
    case "presence": {
      if (event.uid === me) return;
      call("user", event.status === "online" ? "onUserOnline" : "onUserOffline", makeUser(event.uid, db));
      break;
    }
    case "group": {
      if (!isMember(db, event.guid, me) && event.uid !== me) return;
      const group = makeGroup(event.guid, db);
      const user = makeUser(event.uid, db);
      const by = makeUser(event.byUid ?? event.uid, db);
      if (event.action === "joined") call("group", "onGroupMemberJoined", null, user, group);
      if (event.action === "left") call("group", "onGroupMemberLeft", null, user, group);
      if (event.action === "kicked") call("group", "onGroupMemberKicked", null, user, by, group);
      if (event.action === "added") call("group", "onMemberAddedToGroup", null, user, by, group);
      break;
    }
  }
}

// Other tabs get a "storage" event; the sending tab doesn't, so handle locally too.
function emit(event) {
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify({ ...event, nonce: `${Date.now()}-${Math.random()}` }));
  } catch {
    // other tabs miss this event; this tab still updates
  }
  handleEvent(event);
}

function storeMessage(fields) {
  return updateDb((db) => {
    const record = {
      id: db.nextId++,
      sentAt: nowSec(),
      deliveredAt: null,
      readAt: null,
      reactions: {},
      ...fields,
    };
    db.messages.push(record);
    return record;
  });
}

// Marks messages up to `uptoId` as delivered/read and tells the sender's tab.
function markReceipt(field, record, readerUid) {
  const stamp = nowSec();
  const isGroup = record.receiverType === RECEIVER_TYPE.GROUP;
  updateDb((db) => {
    for (const r of db.messages) {
      if (r.id > record.id || r.senderUid !== record.senderUid) continue;
      if (isGroup ? r.receiverId !== record.receiverId : r.receiverId !== readerUid) continue;
      if (!r.deliveredAt) r.deliveredAt = stamp;
      if (field === "readAt" && !r.readAt) r.readAt = stamp;
    }
  });
  const read = field === "readAt";
  emit({
    kind: "receipt",
    field: isGroup ? (read ? "readByAll" : "deliveredToAll") : read ? "read" : "delivered",
    messageId: record.id,
    readerUid,
    targetUid: record.senderUid,
    receiverType: record.receiverType,
    receiverId: record.receiverId,
  });
}

function setReaction(messageId, emoji, uid, add) {
  const record = updateDb((db) => {
    const r = findRecord(db, messageId);
    if (!r) fail("ERR_MESSAGE_NOT_FOUND", "Message not found");
    const uids = new Set(r.reactions?.[emoji] ?? []);
    if (add) uids.add(uid);
    else uids.delete(uid);
    r.reactions = { ...r.reactions, [emoji]: [...uids] };
    return r;
  });
  emit({ kind: "reaction", messageId: record.id, emoji, uid, added: add });
  return fromRecord(record);
}

function replyText(record, bot) {
  if (record.type === MESSAGE_TYPE.IMAGE) return "Nice picture! 📸";
  if (record.type === MESSAGE_TYPE.FILE) return "Got the file, thanks 📎";
  const t = record.text.toLowerCase();
  const firstName = bot.name.split(" ")[0];
  if (/\b(hi|hello|hey)\b/.test(t)) return `Hi! ${firstName} here 👋 How's it going?`;
  if (t.includes("?")) {
    return pick([
      "Good question! Let me check and get back to you.",
      "I think so, yes. Want me to share more details?",
      "Not sure yet, I'll find out today.",
    ]);
  }
  return pick(["Got it 👍", "Sounds good!", "Nice, thanks for the update.", "Haha, love it 😄", "On it!", "Makes sense to me."]);
}

// Bots behave like a real person on the other end: delivered, read, typing, reply.
function scheduleBotReply(record) {
  const db = loadDb();
  const isGroup = record.receiverType === RECEIVER_TYPE.GROUP;
  const bot = isGroup
    ? pick(BOTS.filter((b) => b.uid !== record.senderUid && isMember(db, record.receiverId, b.uid)) || [])
    : BOTS.find((b) => b.uid === record.receiverId);
  if (!bot) return;
  if (!isGroup && (db.blocked[record.senderUid] ?? []).includes(bot.uid)) return;

  const replyTo = isGroup ? record.receiverId : record.senderUid;
  const typing = (started) =>
    emit({ kind: "typing", started, senderUid: bot.uid, receiverId: replyTo, receiverType: record.receiverType });
  const reply = replyText(record, bot);

  setTimeout(() => markReceipt("deliveredAt", record, bot.uid), 400);
  setTimeout(() => {
    markReceipt("readAt", record, bot.uid);
    if (record.type === MESSAGE_TYPE.TEXT && /thank|great|love|awesome/i.test(record.text)) {
      setReaction(record.id, "❤️", bot.uid, true);
    }
    typing(true);
  }, 900);
  setTimeout(() => {
    typing(false);
    const stored = storeMessage({
      senderUid: bot.uid,
      receiverId: replyTo,
      receiverType: record.receiverType,
      type: MESSAGE_TYPE.TEXT,
      text: reply,
    });
    emit({ kind: "message", id: stored.id, actorUid: bot.uid });
  }, 2200 + reply.length * 15);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject({ code: "ERR_FILE_READ", message: "Could not read the file" });
    reader.readAsDataURL(file);
  });
}

function checkCanSend(db, me, receiverId, receiverType) {
  if (receiverType === RECEIVER_TYPE.GROUP) {
    if (!isMember(db, receiverId, me)) fail("ERR_NOT_A_MEMBER", "You are not a member of this group.");
    return;
  }
  if ((db.blocked[me] ?? []).includes(receiverId)) fail("ERR_BLOCKED", "Unblock this user to send a message.");
  if ((db.blocked[receiverId] ?? []).includes(me)) fail("ERR_BLOCKED", "You can't message this user.");
}

function requireAdmin(db, guid, me) {
  if (db.members[guid]?.[me] !== GROUP_MEMBER_SCOPE.ADMIN) fail("ERR_PERMISSION", "Only group admins can do that.");
}

// ---------------------------------------------------------------- top-level API

let connectionStatus = "connected";

function setConnection(status) {
  connectionStatus = status;
  call("connection", { connected: "onConnected", connecting: "inConnecting", disconnected: "onDisconnected" }[status]);
}

async function init() {
  if (!initialized) {
    initialized = true;
    window.addEventListener("storage", (e) => {
      if (e.key === EVENT_KEY && e.newValue) handleEvent(JSON.parse(e.newValue));
    });
    window.addEventListener("beforeunload", () => {
      const me = currentUid();
      if (me) goOffline(me);
    });
    // Mirror the browser's network state, like the real WebSocket would.
    window.addEventListener("offline", () => setConnection("disconnected"));
    window.addEventListener("online", () => {
      setConnection("connecting");
      setTimeout(() => setConnection("connected"), 800);
    });
  }
  loadDb(); // seeds sample data on first run
  const me = currentUid();
  if (me) goOnline(me);
  return true;
}

// Reads the demo token issued by the backend in demo mode: "demo.<base64url JSON {uid, name}>".
// It is not a credential: the demo has no real security and never leaves the browser.
function userFromDemoToken(token) {
  try {
    const binary = atob(token.slice(5).replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const { uid, name } = JSON.parse(json);
    if (typeof uid === "string" && typeof name === "string") return { uid, name };
  } catch {
    // fall through
  }
  return fail("ERR_AUTH_TOKEN_NOT_FOUND", "Invalid demo auth token.");
}

// login(authToken) like the real SDK, or login(uid, "demo") for the sample-user quick login.
async function login(uidOrToken, authKey) {
  await delay(300);
  let uid = uidOrToken;
  if (authKey === undefined) {
    if (!String(uidOrToken).startsWith("demo.")) fail("ERR_AUTH_TOKEN_NOT_FOUND", "Invalid demo auth token.");
    const user = userFromDemoToken(uidOrToken);
    uid = user.uid;
    updateDb((db) => {
      db.users ??= [];
      if (!findUser(uid, db)) db.users.push(user);
    });
  } else if (!findUser(uid)) {
    fail("ERR_UID_NOT_FOUND", `Unknown demo user "${uid}". Use cometchat-uid-1 to cometchat-uid-5.`);
  }
  sessionStorage.setItem(SESSION_KEY, uid);
  goOnline(uid);
  return makeUser(uid);
}

async function logout() {
  const me = currentUid();
  if (me) goOffline(me);
  sessionStorage.removeItem(SESSION_KEY);
}

async function getLoggedinUser() {
  const me = currentUid();
  return me ? makeUser(me) : null;
}

async function sendMessage(message) {
  const me = requireMe();
  await delay(150); // pretend network latency
  checkCanSend(loadDb(), me, message.receiverId, message.receiverType);
  const record = storeMessage({
    senderUid: me,
    receiverId: message.receiverId,
    receiverType: message.receiverType,
    type: MESSAGE_TYPE.TEXT,
    text: message.text,
    quotedMessageId: message.quotedMessageId,
  });
  emit({ kind: "message", id: record.id, actorUid: me });
  scheduleBotReply(record);
  return fromRecord(record);
}

async function sendMediaMessage(message) {
  const me = requireMe();
  checkCanSend(loadDb(), me, message.receiverId, message.receiverType);
  const file = message.file;
  if (file.size > MAX_FILE_BYTES) fail("ERR_FILE_TOO_LARGE", "Demo mode accepts files up to 3 MB.");
  const url = await readFileAsDataUrl(file);
  const record = storeMessage({
    senderUid: me,
    receiverId: message.receiverId,
    receiverType: message.receiverType,
    type: message.type,
    quotedMessageId: message.quotedMessageId,
    attachment: {
      name: file.name,
      url,
      mimeType: file.type,
      size: file.size,
      extension: file.name.split(".").pop(),
    },
  });
  emit({ kind: "message", id: record.id, actorUid: me });
  scheduleBotReply(record);
  return fromRecord(record);
}

async function editMessage(message) {
  const me = requireMe();
  await delay(120);
  const record = updateDb((db) => {
    const r = findRecord(db, message.getId());
    if (!r || r.senderUid !== me) fail("ERR_PERMISSION", "You can only edit your own messages.");
    r.text = message.getText();
    r.editedAt = nowSec();
    return r;
  });
  emit({ kind: "edited", id: record.id, actorUid: me });
  return fromRecord(record);
}

async function deleteMessage(messageId) {
  const me = requireMe();
  await delay(120);
  const record = updateDb((db) => {
    const r = findRecord(db, messageId);
    if (!r || r.senderUid !== me) fail("ERR_PERMISSION", "You can only delete your own messages.");
    r.deletedAt = nowSec();
    return r;
  });
  emit({ kind: "deleted", id: record.id, actorUid: me });
  return fromRecord(record);
}

function sendTyping(indicator, started) {
  const me = currentUid();
  if (!me) return;
  emit({ kind: "typing", started, senderUid: me, receiverId: indicator.receiverId, receiverType: indicator.receiverType });
}

async function markAsRead(message) {
  const me = requireMe();
  const record = findRecord(loadDb(), message.getId());
  if (!record) return;
  updateDb((db) => {
    db.lastRead[me] ??= {};
    const key = convKey(record, me);
    db.lastRead[me][key] = Math.max(db.lastRead[me][key] ?? 0, record.id);
  });
  if (record.receiverType === RECEIVER_TYPE.USER) markReceipt("readAt", record, me);
}

async function markAsDelivered(message) {
  const me = requireMe();
  const record = findRecord(loadDb(), message.getId());
  if (record?.receiverType === RECEIVER_TYPE.USER) markReceipt("deliveredAt", record, me);
}

async function setBlocked(uids, block) {
  const me = requireMe();
  await delay(150);
  updateDb((db) => {
    const current = new Set(db.blocked[me] ?? []);
    uids.forEach((uid) => (block ? current.add(uid) : current.delete(uid)));
    db.blocked[me] = [...current];
  });
  return Object.fromEntries(uids.map((uid) => [uid, { success: true }]));
}

async function deleteConversation(conversationWith, conversationType) {
  const me = requireMe();
  await delay(150);
  updateDb((db) => {
    const key = `${conversationType}:${conversationWith}`;
    const last = db.messages.filter((r) => convKey(r, me) === key).reduce((max, r) => Math.max(max, r.id), 0);
    if (conversationType === RECEIVER_TYPE.GROUP) {
      // Groups keep their history for others; just hide it from my list.
      db.lastRead[me] ??= {};
      db.lastRead[me][key] = last;
    }
    db.cleared[me] ??= {};
    db.cleared[me][key] = last;
  });
  return "Conversation deleted";
}

async function createGroup(group) {
  const me = requireMe();
  await delay(200);
  updateDb((db) => {
    if (db.groups.some((g) => g.guid === group.getGuid())) fail("ERR_GUID_ALREADY_EXISTS", "That group already exists.");
    db.groups.push({ guid: group.getGuid(), name: group.getName(), type: group.getType(), owner: me });
    db.members[group.getGuid()] = { [me]: GROUP_MEMBER_SCOPE.ADMIN };
    // A first message so the group shows up in everyone's chat list.
    db.messages.push({
      id: db.nextId++,
      senderUid: me,
      receiverId: group.getGuid(),
      receiverType: RECEIVER_TYPE.GROUP,
      type: MESSAGE_TYPE.TEXT,
      text: `Created the group "${group.getName()}" 🎉`,
      sentAt: nowSec(),
      reactions: {},
    });
  });
  return makeGroup(group.getGuid());
}

async function joinGroup(guid) {
  const me = requireMe();
  await delay(200);
  updateDb((db) => {
    const group = db.groups.find((g) => g.guid === guid);
    if (!group) fail("ERR_GUID_NOT_FOUND", "Group not found.");
    if (group.type !== GROUP_TYPE.PUBLIC) fail("ERR_NOT_PUBLIC", "This group is invite-only.");
    db.members[guid][me] = GROUP_MEMBER_SCOPE.PARTICIPANT;
  });
  emit({ kind: "group", action: "joined", guid, uid: me });
  return makeGroup(guid);
}

async function leaveGroup(guid) {
  const me = requireMe();
  await delay(200);
  updateDb((db) => {
    const group = db.groups.find((g) => g.guid === guid);
    if (group?.owner === me) fail("ERR_OWNER_LEAVE", "The group owner can't leave the group.");
    delete db.members[guid]?.[me];
  });
  emit({ kind: "group", action: "left", guid, uid: me });
  return true;
}

async function addMembersToGroup(guid, members) {
  const me = requireMe();
  await delay(200);
  updateDb((db) => {
    requireAdmin(db, guid, me);
    members.forEach((m) => (db.members[guid][m.getUid()] = m.getScope() ?? GROUP_MEMBER_SCOPE.PARTICIPANT));
  });
  members.forEach((m) => emit({ kind: "group", action: "added", guid, uid: m.getUid(), byUid: me }));
  return Object.fromEntries(members.map((m) => [m.getUid(), "success"]));
}

async function kickGroupMember(guid, uid) {
  const me = requireMe();
  await delay(200);
  updateDb((db) => {
    requireAdmin(db, guid, me);
    if (db.groups.find((g) => g.guid === guid)?.owner === uid) fail("ERR_PERMISSION", "The owner can't be removed.");
    delete db.members[guid][uid];
  });
  emit({ kind: "group", action: "kicked", guid, uid, byUid: me });
  return true;
}

async function getGroup(guid) {
  const group = makeGroup(guid);
  if (!group) fail("ERR_GUID_NOT_FOUND", "Group not found.");
  return group;
}

const on = (kind) => ({
  add: (id, listener) => listeners[kind].set(id, listener),
  remove: (id) => listeners[kind].delete(id),
});

export const MockCometChat = {
  RECEIVER_TYPE,
  MESSAGE_TYPE,
  GROUP_TYPE,
  GROUP_MEMBER_SCOPE,
  REACTION_ACTION,
  CometChatHelper,
  User,
  Group,
  GroupMember,
  TextMessage,
  MediaMessage,
  TypingIndicator,
  MessageListener,
  UserListener,
  GroupListener,
  ConnectionListener,
  AppSettingsBuilder,
  ConversationsRequestBuilder,
  UsersRequestBuilder,
  GroupsRequestBuilder,
  GroupMembersRequestBuilder,
  MessagesRequestBuilder,
  init,
  login,
  logout,
  getLoggedinUser,
  sendMessage,
  sendMediaMessage,
  editMessage,
  deleteMessage,
  addReaction: async (messageId, emoji) => setReaction(messageId, emoji, requireMe(), true),
  removeReaction: async (messageId, emoji) => setReaction(messageId, emoji, requireMe(), false),
  startTyping: (indicator) => sendTyping(indicator, true),
  endTyping: (indicator) => sendTyping(indicator, false),
  markAsRead,
  markAsDelivered,
  blockUsers: (uids) => setBlocked(uids, true),
  unblockUsers: (uids) => setBlocked(uids, false),
  deleteConversation,
  createGroup,
  joinGroup,
  leaveGroup,
  addMembersToGroup,
  kickGroupMember,
  getGroup,
  getConnectionStatus: () => connectionStatus,
  addMessageListener: on("message").add,
  removeMessageListener: on("message").remove,
  addUserListener: on("user").add,
  removeUserListener: on("user").remove,
  addGroupListener: on("group").add,
  removeGroupListener: on("group").remove,
  addConnectionListener: on("connection").add,
  removeConnectionListener: on("connection").remove,
};
