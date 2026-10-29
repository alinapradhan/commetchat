// The only module that talks to the CometChat SDK directly for setup, auth,
// fetching and sending. Components and hooks go through these helpers so the
// rest of the app works with plain "chat target" objects instead of SDK classes.
import { CometChat as SdkCometChat } from "@cometchat/chat-sdk-javascript";
import { MockCometChat } from "./demo/mockCometChat";

// App ID and region are public identifiers. The secret REST API key stays on our server.
const APP_ID = import.meta.env.VITE_COMETCHAT_APP_ID;
const REGION = import.meta.env.VITE_COMETCHAT_REGION;

export const MESSAGE_PAGE_SIZE = 30;
export const LIST_PAGE_SIZE = 30;

// `npm run demo` swaps in an offline, in-browser fake of the SDK.
export const isDemo = import.meta.env.VITE_DEMO_MODE === "true";
const CometChat = isDemo ? MockCometChat : SdkCometChat;

// Real CometChat always signs in through our backend. Only the offline demo
// (`npm run demo`) has the quick "pick a sample user" login.
export const useBackend = !isDemo || import.meta.env.VITE_USE_BACKEND === "true";

export const isConfigured = isDemo || Boolean(APP_ID && REGION);

let initPromise = null;

// init() must run once before any other SDK call. Memoised so React
// StrictMode's double effects don't initialise twice.
export function initCometChat() {
  if (!initPromise) {
    const settings = new CometChat.AppSettingsBuilder()
      .subscribePresenceForAllUsers()
      .setRegion(REGION)
      .autoEstablishSocketConnection(true)
      .build();
    initPromise = CometChat.init(APP_ID, settings);
  }
  return initPromise;
}

export const getLoggedInUser = () => CometChat.getLoggedinUser();
// Auth tokens come from our backend (POST /api/chat/token).
export const loginWithToken = (authToken) => CometChat.login(authToken);
// Offline demo only: the fake backend accepts a bare sample-user id.
export const loginWithUid = (uid) => CometChat.login(uid, "demo");
export const logout = () => CometChat.logout();

// ---------------------------------------------------------------- chat targets

// A "chat target" is who you are talking to: a user (1:1) or a group.
export function toChatTarget(entity) {
  if (entity instanceof CometChat.Group) {
    return {
      type: CometChat.RECEIVER_TYPE.GROUP,
      id: entity.getGuid(),
      name: entity.getName(),
      avatar: entity.getIcon(),
      groupType: entity.getType(),
      hasJoined: entity.getHasJoined(),
      membersCount: entity.getMembersCount(),
      scope: entity.getScope(),
      owner: entity.getOwner?.(),
    };
  }
  return {
    type: CometChat.RECEIVER_TYPE.USER,
    id: entity.getUid(),
    name: entity.getName(),
    avatar: entity.getAvatar(),
    status: entity.getStatus(),
    blockedByMe: entity.getBlockedByMe?.() ?? false,
    hasBlockedMe: entity.getHasBlockedMe?.() ?? false,
  };
}

export const targetKey = (target) => `${target.type}:${target.id}`;
export const isGroupTarget = (target) => target.type === CometChat.RECEIVER_TYPE.GROUP;
export const isGroupAdmin = (target) => target.scope === CometChat.GROUP_MEMBER_SCOPE.ADMIN;

// Works out which chat a message belongs to, from the current user's view.
export function targetKeyFromMessage(message, myUid) {
  if (message.getReceiverType() === CometChat.RECEIVER_TYPE.GROUP) {
    return `group:${message.getReceiverId()}`;
  }
  const senderUid = message.getSender().getUid();
  const otherUid = senderUid === myUid ? message.getReceiverId() : senderUid;
  return `user:${otherUid}`;
}

// ---------------------------------------------------------------- paged lists
// Each create*Request returns { fetchNext() } that yields plain objects, one page per call.

function paged(request, map) {
  return { fetchNext: async () => (await request.fetchNext()).map(map) };
}

function toConversation(conversation) {
  const target = toChatTarget(conversation.getConversationWith());
  return {
    key: targetKey(target),
    target,
    lastMessage: conversation.getLastMessage() ?? null,
    unread: conversation.getUnreadMessageCount() ?? 0,
  };
}

export function createConversationsRequest() {
  return paged(new CometChat.ConversationsRequestBuilder().setLimit(LIST_PAGE_SIZE).build(), toConversation);
}

export function createUsersRequest(keyword = "") {
  const builder = new CometChat.UsersRequestBuilder().setLimit(LIST_PAGE_SIZE);
  if (keyword) builder.setSearchKeyword(keyword);
  return paged(builder.build(), toChatTarget);
}

export function createGroupsRequest(keyword = "") {
  const builder = new CometChat.GroupsRequestBuilder().setLimit(LIST_PAGE_SIZE);
  if (keyword) builder.setSearchKeyword(keyword);
  return paged(builder.build(), toChatTarget);
}

export function createMembersRequest(guid) {
  const request = new CometChat.GroupMembersRequestBuilder(guid).setLimit(LIST_PAGE_SIZE).build();
  return paged(request, (member) => ({ ...toChatTarget(member), scope: member.getScope() }));
}

// Returns a request object; call fetchPrevious() repeatedly to page back.
export function createMessagesRequest(target) {
  const builder = new CometChat.MessagesRequestBuilder()
    .setLimit(MESSAGE_PAGE_SIZE)
    .setCategories(["message"]);
  if (isGroupTarget(target)) builder.setGUID(target.id);
  else builder.setUID(target.id);
  return builder.build();
}

// ---------------------------------------------------------------- messages

export function sendTextMessage(target, text, replyTo) {
  const message = new CometChat.TextMessage(target.id, text, target.type);
  if (replyTo) message.setQuotedMessageId(replyTo.getId());
  return CometChat.sendMessage(message);
}

export function sendMediaMessage(target, file, replyTo) {
  const type = file.type.startsWith("image/") ? CometChat.MESSAGE_TYPE.IMAGE : CometChat.MESSAGE_TYPE.FILE;
  const message = new CometChat.MediaMessage(target.id, file, type, target.type);
  if (replyTo) message.setQuotedMessageId(replyTo.getId());
  return CometChat.sendMediaMessage(message);
}

export function editTextMessage(message, text) {
  const edited = new CometChat.TextMessage(message.getReceiverId(), text, message.getReceiverType());
  edited.setId(message.getId());
  return CometChat.editMessage(edited);
}

export const deleteMessage = (message) => CometChat.deleteMessage(message.getId());

export function toggleReaction(message, emoji) {
  const mine = reactionsOf(message).some((r) => r.emoji === emoji && r.mine);
  return mine ? CometChat.removeReaction(message.getId(), emoji) : CometChat.addReaction(message.getId(), emoji);
}

// Applies a live reaction event to a message and returns the updated message.
export function applyReactionEvent(message, event, added) {
  const action = added ? CometChat.REACTION_ACTION.REACTION_ADDED : CometChat.REACTION_ACTION.REACTION_REMOVED;
  const updated = CometChat.CometChatHelper.updateMessageWithReactionInfo(message, event.getReaction(), action);
  return typeof updated?.getId === "function" ? updated : message;
}

export function setTyping(target, isTyping) {
  const indicator = new CometChat.TypingIndicator(target.id, target.type);
  if (isTyping) CometChat.startTyping(indicator);
  else CometChat.endTyping(indicator);
}

export function messageKind(message) {
  if (message.getDeletedAt?.()) return "deleted";
  if (message.getCategory() === "action") return "action";
  switch (message.getType()) {
    case "text":
      return "text";
    case "image":
      return "image";
    case "file":
    case "audio":
    case "video":
      return "file";
    default:
      return "other";
  }
}

export function attachmentOf(message) {
  const attachment = message.getAttachment?.();
  const url = attachment?.getUrl?.() ?? message.getURL?.();
  if (!url) return null;
  return {
    url,
    name: attachment?.getName?.() ?? "File",
    mimeType: attachment?.getMimeType?.() ?? "",
    size: attachment?.getSize?.() ?? 0,
  };
}

export function reactionsOf(message) {
  return (message.getReactions?.() ?? [])
    .map((r) => ({ emoji: r.getReaction(), count: r.getCount(), mine: r.getReactedByMe() }))
    .filter((r) => r.count > 0);
}

export const quotedMessageOf = (message) => message.getQuotedMessage?.() ?? null;

export function previewText(message) {
  if (!message) return "";
  switch (messageKind(message)) {
    case "deleted":
      return "Message deleted";
    case "action":
      return "Group update";
    case "text":
      return message.getText();
    case "image":
      return "📷 Photo";
    case "file":
      return `📎 ${attachmentOf(message)?.name ?? "File"}`;
    default:
      return `[${message.getType()}]`;
  }
}

// ---------------------------------------------------------------- users and groups

export const blockUser = (uid) => CometChat.blockUsers([uid]);
export const unblockUser = (uid) => CometChat.unblockUsers([uid]);
export const deleteConversation = (target) => CometChat.deleteConversation(target.id, target.type);

export function createGroup(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
  const guid = `${slug}-${Date.now().toString(36)}`;
  const group = new CometChat.Group(guid, name, CometChat.GROUP_TYPE.PUBLIC);
  return CometChat.createGroup(group).then(toChatTarget);
}

export const fetchGroup = (guid) => CometChat.getGroup(guid).then(toChatTarget);
export const joinGroup = (guid) => CometChat.joinGroup(guid, CometChat.GROUP_TYPE.PUBLIC, "").then(toChatTarget);
export const leaveGroup = (guid) => CometChat.leaveGroup(guid);
export const kickGroupMember = (guid, uid) => CometChat.kickGroupMember(guid, uid);

export function addGroupMembers(guid, uids) {
  const members = uids.map((uid) => new CometChat.GroupMember(uid, CometChat.GROUP_MEMBER_SCOPE.PARTICIPANT));
  return CometChat.addMembersToGroup(guid, members, []);
}

// ---------------------------------------------------------------- live subscriptions

// Calls back with the guid of any group whose membership changed. Returns an unsubscribe function.
export function onGroupChange(id, callback) {
  const handle = (...args) => {
    const group = args.find((a) => a instanceof CometChat.Group);
    callback(group?.getGuid() ?? null);
  };
  CometChat.addGroupListener(
    id,
    new CometChat.GroupListener({
      onGroupMemberJoined: handle,
      onGroupMemberLeft: handle,
      onGroupMemberKicked: handle,
      onGroupMemberBanned: handle,
      onGroupMemberScopeChanged: handle,
      onMemberAddedToGroup: handle,
    }),
  );
  return () => CometChat.removeGroupListener(id);
}

// Calls back with "connected" | "connecting" | "disconnected". Returns an unsubscribe function.
export function onConnectionChange(callback) {
  const id = "connection-status";
  CometChat.addConnectionListener(
    id,
    new CometChat.ConnectionListener({
      onConnected: () => callback("connected"),
      inConnecting: () => callback("connecting"),
      onDisconnected: () => callback("disconnected"),
    }),
  );
  return () => CometChat.removeConnectionListener(id);
}

export { CometChat };
