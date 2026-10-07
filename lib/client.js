window.__ModuleLoader__.load({
  id: "dsh-context-surgery",
  factory(require) {
    const React = require("react");

    // ── 文案（跟随浏览器语言，中/英）─────────────────────────────────────
    const ZH = /^zh\b/i.test((typeof navigator !== "undefined" && navigator.language) || "");
    const L = ZH
      ? {
          editReply: "改写这条回复的正文（保留思考链）",
          editThinking: "改写这条消息的思考链（保留回复正文）",
          deleteMsg: "删除这条消息（模型视角消失，原始文本仍在日志）",
          restore: "还原被改写的内容",
          save: "保存",
          saving: "保存中…",
          cancel: "取消",
          labelReply: "回复正文（text）· 保留思考链与工具调用",
          labelThinking: "思考链（reasoning）· 留空保存 = 移除",
          placeholderReply: "新回复…",
          placeholderThinking: "新的思考链…（留空 = 移除思考链）",
          savedReply: "回复已改写 ✓",
          savedThinking: "思考链已改写 ✓",
          savedDelete: "已删除 ✓",
          savedRestore: "已还原 ✓",
          confirmDelete: "删除这条消息（模型视角消失，原始文本仍在日志）？",
          rewritten: "已改写",
          rewrittenTip: "这条消息是改写节点，原文仍在事件日志里",
          editLastShort: "改我的消息",
          editLastTitle: "编辑我最近发的一条消息（只改模型看到的历史，不重发）",
          editLastLabel: "编辑我最近发的一条消息 · 只改写模型可见历史，不会重新发送",
          noUserMessage: "没有可编辑的用户消息",
          savedUserEdit: "我的消息已改写 ✓",
        }
      : {
          editReply: "Rewrite this reply (keeps the thinking chain)",
          editThinking: "Rewrite this thinking chain (keeps the reply)",
          deleteMsg: "Delete this message (gone from the model's view; the original stays in the log)",
          restore: "Restore the rewritten content",
          save: "Save",
          saving: "Saving…",
          cancel: "Cancel",
          labelReply: "Reply text (text) · thinking chain and tool calls are kept",
          labelThinking: "Thinking chain (reasoning) · save empty to remove it",
          placeholderReply: "New reply…",
          placeholderThinking: "New thinking chain… (empty = remove)",
          savedReply: "Reply rewritten ✓",
          savedThinking: "Thinking chain rewritten ✓",
          savedDelete: "Deleted ✓",
          savedRestore: "Restored ✓",
          confirmDelete: "Delete this message (it disappears from the model's view; the original stays in the log)?",
          rewritten: "rewritten",
          rewrittenTip: "This node is a rewrite; the original text is still in the event log",
          editLastShort: "Edit mine",
          editLastTitle: "Edit my most recent message (changes the model-visible history only, nothing is sent)",
          editLastLabel: "Edit my most recent message · rewrites the model-visible history only, nothing is sent",
          noUserMessage: "No user message to edit",
          savedUserEdit: "My message was rewritten ✓",
        };

    // ── 图标（DSH primitives 同款，内联避免跨插件导入）─────────────────────
    const IconEdit16 = ({ size = 14 }) => React.createElement(
      "svg",
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", style: { display: "block" } },
      React.createElement("path", { d: "M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z", fill: "currentColor" })
    );

    /** DSH primitives 同款图标（内联，避免跨插件导入） */
    const IconThink16 = ({ size = 14 }) => React.createElement(
      "svg",
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", style: { display: "block" } },
      React.createElement("path", { d: "M8.00192 6.64454C8.75026 6.64454 9.35732 7.25169 9.35739 8.00001C9.35739 8.74838 8.7503 9.35548 8.00192 9.35548C7.25367 9.35533 6.64743 8.74829 6.64743 8.00001C6.6475 7.25178 7.25371 6.64468 8.00192 6.64454Z", fill: "currentColor" }),
      React.createElement("path", { d: "M9.97165 1.29981C11.5853 0.718916 13.271 0.642197 14.3144 1.68555C15.3577 2.72902 15.2811 4.41466 14.7002 6.02833C14.4707 6.66561 14.1504 7.32937 13.75 8.00001C14.1504 8.67062 14.4707 9.33444 14.7002 9.97169C15.2811 11.5854 15.3578 13.271 14.3144 14.3145C13.271 15.3579 11.5854 15.2811 9.97165 14.7002C9.3344 14.4708 8.67059 14.1505 7.99997 13.75C7.32933 14.1505 6.66558 14.4708 6.02829 14.7002C4.41461 15.2811 2.72899 15.3578 1.68552 14.3145C0.642155 13.271 0.71887 11.5854 1.29977 9.97169C1.52915 9.33454 1.84865 8.67049 2.24899 8.00001C1.84866 7.32953 1.52915 6.66544 1.29977 6.02833C0.718852 4.41459 0.64207 2.729 1.68552 1.68555C2.72897 0.642112 4.41456 0.718887 6.02829 1.29981C6.66541 1.52918 7.32949 1.8487 7.99997 2.24903C8.67045 1.84869 9.33451 1.52919 9.97165 1.29981ZM12.9404 9.2129C12.4391 9.893 11.8616 10.5681 11.2148 11.2149C10.568 11.8616 9.89296 12.4391 9.21286 12.9404C9.62532 13.1579 10.0271 13.338 10.4121 13.4766C11.9146 14.0174 12.9172 13.8738 13.3955 13.3955C13.8737 12.9173 14.0174 11.9146 13.4765 10.4121C13.3379 10.0271 13.1578 9.62535 12.9404 9.2129ZM3.05856 9.2129C2.84121 9.62523 2.66197 10.0272 2.52341 10.4121C1.98252 11.9146 2.12627 12.9172 2.60446 13.3955C3.08278 13.8737 4.08544 14.0174 5.58786 13.4766C5.97264 13.338 6.37389 13.1577 6.7861 12.9404C6.10624 12.4393 5.43168 11.8614 4.78513 11.2149C4.13823 10.5679 3.55992 9.89313 3.05856 9.2129ZM7.99899 3.792C7.23179 4.31419 6.45306 4.95512 5.70407 5.70411C4.95509 6.45309 4.31415 7.23184 3.79196 7.99903C4.3143 8.76666 4.95471 9.54653 5.70407 10.2959C6.45309 11.0449 7.23271 11.6848 7.99997 12.207C8.76725 11.6848 9.54683 11.0449 10.2959 10.2959C11.0449 9.54686 11.6848 8.76729 12.207 8.00001C11.6848 7.23275 11.0449 6.45312 10.2959 5.70411C9.5465 4.95475 8.76662 4.31434 7.99899 3.792ZM5.58786 2.52344C4.08533 1.98255 3.08272 2.12625 2.60446 2.6045C2.12621 3.08275 1.98252 4.08536 2.52341 5.5879C2.66189 5.97253 2.8414 6.37409 3.05856 6.78614C3.55983 6.10611 4.1384 5.43189 4.78513 4.78514C5.43197 4.1383 6.10645 3.55953 6.78615 3.05854C6.3741 2.84138 5.9725 2.66192 5.58786 2.52344Z", fill: "currentColor" })
    );

    /** DSH primitives 同款图标（内联，避免跨插件导入） */
    const IconTrash16 = ({ size = 14 }) => React.createElement(
      "svg",
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", style: { display: "block" } },
      React.createElement("path", { d: "M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z", fill: "currentColor" })
    );

    /** 还原图标（箭头回转，0.2.0 新增） */
    const IconRestore16 = ({ size = 14 }) => React.createElement(
      "svg",
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", style: { display: "block" } },
      React.createElement("path", { d: "M8 2.5a5.5 5.5 0 1 1-5.4 6.6h1.6A4 4 0 1 0 8 4a3.9 3.9 0 0 0-2.7 1.1L7 6.7H2.6V2.3l1.5 1.5A5.4 5.4 0 0 1 8 2.5Z", fill: "currentColor" })
    );

    // ── API ────────────────────────────────────────────────────────────────
    const prefix = "/api/dsh-context-surgery";
    const post = (route, body) =>
      fetch(prefix + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    const api = {
      message: (sessionId, messageId) =>
        fetch(prefix + "/message?sessionId=" + encodeURIComponent(sessionId) + "&messageId=" + encodeURIComponent(messageId)).then((r) => r.json()),
      edit: (sessionId, seq, part, text) => post("/edit", { sessionId, seq, part, text }),
      remove: (sessionId, seq) => post("/delete", { sessionId, seq }),
      restore: (sessionId, seq) => post("/restore", { sessionId, seq }),
      lastUser: (sessionId) =>
        fetch(prefix + "/last-user?sessionId=" + encodeURIComponent(sessionId)).then((r) => r.json()),
    };

    // ── 样式常量（复用 DSH 设计变量）───────────────────────────────────────
    const ICON_BTN = {
      background: "none",
      border: "none",
      padding: "2px",
      margin: "0 1px",
      cursor: "pointer",
      color: "var(--dsw-alias-label-tertiary)",
      borderRadius: 4,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 0,
    };
    const ICON_BTN_HOVER = {
      background: "var(--dsw-alias-interactive-bg-hover)",
      color: "var(--dsw-alias-label-secondary)",
    };
    const EDITROW = {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      padding: "4px 6px",
      marginTop: 4,
      borderRadius: 6,
      background: "var(--dsw-alias-bg-layer-1)",
      border: "1px solid var(--dsw-alias-border-l1)",
      maxWidth: 480,
    };
    const EDITLABEL = { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", margin: 0 };
    const EDITBOX = {
      width: "100%",
      boxSizing: "border-box",
      background: "var(--dsw-alias-bg-layer-2)",
      color: "var(--dsw-alias-label-primary)",
      border: "1px solid var(--dsw-alias-border-l1)",
      borderRadius: 6,
      padding: "4px 6px",
      fontSize: 12,
      minHeight: 56,
      fontFamily: "inherit",
    };
    const SAVE = {
      background: "rgba(77, 166, 255, 0.16)",
      color: "#4da6ff",
      border: "1px solid rgba(77, 166, 255, 0.35)",
      borderRadius: 6,
      padding: "1px 10px",
      fontSize: 12,
      cursor: "pointer",
      marginRight: 6,
    };
    const CANCEL = {
      background: "var(--dsw-alias-bg-layer-2)",
      color: "var(--dsw-alias-label-secondary)",
      border: "1px solid var(--dsw-alias-border-l1)",
      borderRadius: 6,
      padding: "1px 10px",
      fontSize: 12,
      cursor: "pointer",
    };
    const MSG = { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", margin: 0 };
    const BADGE = {
      fontSize: 10,
      lineHeight: "14px",
      padding: "0 5px",
      borderRadius: 999,
      background: "rgba(230, 160, 60, 0.16)",
      color: "#e0a03c",
      border: "1px solid rgba(230, 160, 60, 0.35)",
      marginLeft: 4,
    };

    // ── 每条 AI 消息下方的操作：改回复 / 改思考链 / 还原 / 删 ──────────────
    function MessageSurgeryActions(props) {
      const messageId = props && props.messageId ? props.messageId : null;
      const sessionId = props && props.sessionId ? props.sessionId : null;
      const [info, setInfo] = React.useState(null);
      const [editing, setEditing] = React.useState(null); // "reply" | "thinking" | null
      const [draft, setDraft] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [msg, setMsg] = React.useState(null);

      const refresh = React.useCallback(() => {
        if (!messageId || !sessionId) return;
        api
          .message(sessionId, messageId)
          .then((data) => setInfo(data && data.ok ? data : null))
          .catch(() => setInfo(null));
      }, [messageId, sessionId]);

      React.useEffect(() => {
        refresh();
      }, [refresh]);

      if (!messageId || !sessionId) return null;

      const startEdit = (part) => {
        setEditing(part);
        setDraft(part === "thinking" ? (info && info.reasoning) || "" : (info && info.reply) || "");
        setMsg(null);
      };

      const finish = (data, okText) => {
        setBusy(false);
        if (data && data.ok) {
          setEditing(null);
          setMsg(okText);
          refresh();
        } else {
          setMsg("✗ " + ((data && data.error) || "failed"));
        }
      };

      const saveEdit = () => {
        if (busy || !editing || !info) return;
        setBusy(true);
        api
          .edit(sessionId, info.seq, editing, draft)
          .then((data) => finish(data, editing === "thinking" ? L.savedThinking : L.savedReply))
          .catch((e) => {
            setBusy(false);
            setMsg("✗ " + String((e && e.message) || e));
          });
      };

      const remove = () => {
        if (busy || !info) return;
        if (!window.confirm(L.confirmDelete)) return;
        setBusy(true);
        api
          .remove(sessionId, info.seq)
          .then((data) => finish(data, L.savedDelete))
          .catch((e) => {
            setBusy(false);
            setMsg("✗ " + String((e && e.message) || e));
          });
      };

      const restore = () => {
        if (busy || !info) return;
        setBusy(true);
        api
          .restore(sessionId, info.seq)
          .then((data) => finish(data, L.savedRestore))
          .catch((e) => {
            setBusy(false);
            setMsg("✗ " + String((e && e.message) || e));
          });
      };

      const iconButton = (label, onClick, children) =>
        React.createElement(
          "button",
          {
            type: "button",
            style: ICON_BTN,
            title: label,
            "aria-label": label,
            onClick: onClick,
            onMouseEnter: (e) => {
              e.currentTarget.style.background = ICON_BTN_HOVER.background;
              e.currentTarget.style.color = ICON_BTN_HOVER.color;
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "";
            },
          },
          children
        );

      const badge = info && info.isRewritten
        ? React.createElement("span", { style: BADGE, title: L.rewrittenTip }, L.rewritten)
        : null;

      return React.createElement(
        React.Fragment,
        null,
        !editing
          ? React.createElement(
              React.Fragment,
              null,
              iconButton(L.editReply, () => startEdit("reply"), React.createElement(IconEdit16, { size: 14 })),
              info && info.hasReasoning
                ? iconButton(L.editThinking, () => startEdit("thinking"), React.createElement(IconThink16, { size: 14 }))
                : null,
              info && info.isRewritten
                ? iconButton(L.restore, restore, React.createElement(IconRestore16, { size: 14 }))
                : null,
              info
                ? iconButton(L.deleteMsg, remove, React.createElement(IconTrash16, { size: 14 }))
                : null,
              badge,
              msg ? React.createElement("span", { style: MSG }, " " + msg) : null
            )
          : React.createElement(
              "div",
              { style: EDITROW },
              React.createElement("p", { style: EDITLABEL }, editing === "thinking" ? L.labelThinking : L.labelReply),
              React.createElement("textarea", {
                style: EDITBOX,
                value: draft,
                onChange: (e) => setDraft(e.target.value),
                placeholder: editing === "thinking" ? L.placeholderThinking : L.placeholderReply,
              }),
              React.createElement(
                "div",
                null,
                React.createElement("button", { style: SAVE, onClick: saveEdit, disabled: busy }, busy ? L.saving : L.save),
                React.createElement("button", { style: CANCEL, onClick: () => setEditing(null), disabled: busy }, L.cancel),
                msg ? React.createElement("span", { style: MSG }, " " + msg) : null
              )
            )
      );
    }

    // ── 输入区：编辑「我最近发的一条消息」──────────────────────────────────
    // 按官方插槽约定：可点击的小控件放 conversation.input.left（卡片工具行），
    // 需要整行、带正文的内容放 conversation.input.dock（卡片上方一行）。
    // 两处共享下面这个极小的 store。
    const TOOL_BTN = {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: "none",
      border: "none",
      padding: "2px 6px",
      margin: "0 2px",
      cursor: "pointer",
      color: "var(--dsw-alias-label-tertiary)",
      borderRadius: 6,
      fontSize: 12,
      lineHeight: "18px",
    };
    const PANEL = {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      padding: "6px 8px",
      marginBottom: 6,
      borderRadius: 8,
      background: "var(--dsw-alias-bg-layer-1)",
      border: "1px solid var(--dsw-alias-border-l1)",
    };

    const editorStore = (() => {
      let state = { open: false, sessionId: null, seq: null, draft: "", busy: false, msg: null };
      const listeners = new Set();
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch };
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    })();

    function useEditorStore() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        const off = editorStore.subscribe(() => bump((n) => n + 1));
        return () => {
          off();
        };
      }, []);
      return editorStore.get();
    }

    function sessionIdOf(props) {
      if (!props) return null;
      return props.sessionId ?? props.session?.id ?? props.session?.sessionId ?? null;
    }

    /** 工具行里的「改我的消息」按钮。 */
    function ComposerEditButton(props) {
      const state = useEditorStore();
      const sessionId = sessionIdOf(props) ?? state.sessionId;

      const begin = () => {
        if (!sessionId || state.busy) return;
        editorStore.set({ busy: true, msg: null });
        api
          .lastUser(sessionId)
          .then((data) => {
            if (!data || !data.ok) {
              editorStore.set({ busy: false, msg: "✗ " + ((data && data.error) || "failed") });
              return;
            }
            if (!data.found) {
              editorStore.set({ busy: false, msg: L.noUserMessage });
              return;
            }
            editorStore.set({
              busy: false,
              open: true,
              sessionId,
              seq: data.seq,
              draft: data.text || "",
            });
          })
          .catch((e) => editorStore.set({ busy: false, msg: "✗ " + String((e && e.message) || e) }));
      };

      return React.createElement(
        "span",
        { style: { display: "inline-flex", alignItems: "center" } },
        React.createElement(
          "button",
          {
            type: "button",
            style: TOOL_BTN,
            title: L.editLastTitle,
            "aria-label": L.editLastTitle,
            onClick: begin,
            disabled: state.busy,
            onMouseEnter: (e) => {
              e.currentTarget.style.background = ICON_BTN_HOVER.background;
              e.currentTarget.style.color = ICON_BTN_HOVER.color;
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "";
            },
          },
          React.createElement(IconEdit16, { size: 14 }),
          React.createElement("span", null, L.editLastShort)
        ),
        state.msg && !state.open ? React.createElement("span", { style: MSG }, " " + state.msg) : null
      );
    }

    /** 卡片上方那一行编辑器。 */
    function ComposerEditPanel() {
      const state = useEditorStore();
      if (!state.open) return null;

      const save = () => {
        if (state.busy || state.seq === null || !state.sessionId) return;
        editorStore.set({ busy: true });
        api
          .edit(state.sessionId, state.seq, "reply", state.draft)
          .then((data) => {
            if (data && data.ok) editorStore.set({ busy: false, open: false, msg: L.savedUserEdit });
            else editorStore.set({ busy: false, msg: "✗ " + ((data && data.error) || "failed") });
          })
          .catch((e) => editorStore.set({ busy: false, msg: "✗ " + String((e && e.message) || e) }));
      };

      return React.createElement(
        "div",
        { style: PANEL },
        React.createElement("p", { style: EDITLABEL }, L.editLastLabel),
        React.createElement("textarea", {
          style: EDITBOX,
          value: state.draft,
          onChange: (e) => editorStore.set({ draft: e.target.value }),
          placeholder: L.placeholderReply,
        }),
        React.createElement(
          "div",
          null,
          React.createElement("button", { style: SAVE, onClick: save, disabled: state.busy }, state.busy ? L.saving : L.save),
          React.createElement(
            "button",
            { style: CANCEL, onClick: () => editorStore.set({ open: false }), disabled: state.busy },
            L.cancel
          ),
          state.msg ? React.createElement("span", { style: MSG }, " " + state.msg) : null
        )
      );
    }

    // ── 注册 ────────────────────────────────────────────────────────────────
    return {
      inject: ["slots"],
      apply(ctx) {
        const slots = ctx.slots ?? (typeof ctx.get === "function" ? ctx.get("slots") : undefined);
        if (!slots) return;
        slots.inject("conversation.chat.assistant-actions", () =>
          slots.register(
            { name: "conversation.chat.assistant-actions", id: "context-surgery-message", order: 20, label: ZH ? "消息改写" : "Message surgery" },
            (props) => React.createElement(MessageSurgeryActions, props)
          )
        );
        slots.inject("conversation.input.left", () =>
          slots.register(
            {
              name: "conversation.input.left",
              id: "context-surgery-edit-last",
              order: 30,
              label: L.editLastShort,
              inject: (sessionId) => ({ sessionId }),
            },
            (props) => React.createElement(ComposerEditButton, props)
          )
        );
        slots.inject("conversation.input.dock", () =>
          slots.register(
            { name: "conversation.input.dock", id: "context-surgery-editor", order: 30 },
            () => React.createElement(ComposerEditPanel, null)
          )
        );
      },
    };
  },
});
