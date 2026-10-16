// Browser-local thread records. Each write checks its revision in one IDB transaction.
(() => {
  "use strict";
  let database;
  const stores = ["threads", "index", "meta"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const imageIds = messages => [...new Set(messages.flatMap(m => (m.tools || []).map(t => t.image?.id).filter(Boolean)))];
  function clean(messages) {
    return clone(messages.map(m => ({...m, images:(m.images || []).map(i => ({name:i.name})), files:(m.files || []).map(f => ({name:f.name}))})));
  }
  function fresh(model = null) {
    const now = Date.now();
    return {id:crypto.randomUUID(), title:"New chat", renamed:false, created:now, updated:now, revision:0, model, draft:"", messages:[]};
  }
  function metadata(record) {
    return {id:record.id, title:record.title, created:record.created, updated:record.updated,
      model:record.model, revision:record.revision, count:record.messages.length, imageIds:imageIds(record.messages)};
  }
  function open() {
    if (!database) database = new Promise((resolve,reject) => {
      let expired = false;
      const request = indexedDB.open("strata.chatThreads", 1);
      const timer = setTimeout(() => { expired = true; reject(new Error("Thread storage timed out")); }, 5000);
      request.onupgradeneeded = () => stores.forEach(name => request.result.createObjectStore(name, {keyPath:name === "meta" ? "key" : "id"}));
      request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error("Thread storage is blocked by another tab")); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (expired) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); database = null; };
        resolve(request.result);
      };
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(stores, mode);
      let result, failure;
      const done = value => { result = value; };
      const fail = message => { failure = new Error(message); tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error("Thread storage transaction failed"));
      tx.onerror = () => {};
      try { operation(tx, done, fail); } catch (error) { failure = error; tx.abort(); }
    });
  }
  function title(text) {
    return String(text).replace(/[\x00-\x1f\x7f]/g," ").replace(/\s+/g," ").trim().slice(0,120);
  }
  async function initialize(legacy, model) {
    return transaction("readwrite", (tx,done) => {
      const marker = tx.objectStore("meta").get("migration-v1");
      marker.onsuccess = () => {
        if (marker.result) { done(null); return; }
        const record = fresh(model);
        record.messages = clean(Array.isArray(legacy) ? legacy : []);
        record.title = title(record.messages.find(m => m.role === "user")?.text || "New chat").slice(0,60);
        record.revision = 1;
        tx.objectStore("threads").add(record);
        tx.objectStore("index").add(metadata(record));
        tx.objectStore("meta").put({key:"migration-v1", id:record.id});
        done(record.id);
      };
    });
  }
  const list = () => transaction("readonly", (tx,done) => {
    const request = tx.objectStore("index").getAll();
    request.onsuccess = () => done(request.result.sort((a,b) => b.updated-a.updated || a.id.localeCompare(b.id)));
  });
  const get = id => transaction("readonly", (tx,done) => {
    const request = tx.objectStore("threads").get(id);
    request.onsuccess = () => done(request.result || null);
  });
  async function save(snapshot, expectedRevision) {
    if (snapshot.private) throw new Error("Private chats cannot be written to the library");
    const record = {...clone(snapshot), messages:clean(snapshot.messages)};
    return transaction("readwrite", (tx,done,fail) => {
      const request = tx.objectStore("threads").get(record.id);
      request.onsuccess = () => {
        if ((request.result?.revision || 0) !== expectedRevision) {
          fail("This thread changed in another tab. Your unsaved chat is still here; export it before reloading to open the saved version."); return;
        }
        record.revision = expectedRevision + 1;
        record.updated = Date.now();
        if (!record.renamed) record.title = title(record.messages.find(m => m.role === "user")?.text || "New chat").slice(0,60);
        tx.objectStore("threads").put(record);
        tx.objectStore("index").put(metadata(record));
        done(record);
      };
    });
  }
  async function remove(id, revision) {
    return transaction("readwrite", (tx,done,fail) => {
      const request = tx.objectStore("threads").get(id);
      request.onsuccess = () => {
        if (!request.result || request.result.revision !== revision) { fail("Thread changed or was deleted in another tab. Refresh the library before deleting it."); return; }
        const candidates = new Set(imageIds(request.result.messages));
        const index = tx.objectStore("index").getAll();
        index.onsuccess = () => {
          for (const other of index.result) if (other.id !== id) for (const image of other.imageIds || []) candidates.delete(image);
          tx.objectStore("threads").delete(id);
          tx.objectStore("index").delete(id);
          done([...candidates]);
        };
      };
    });
  }
  globalThis.StrataThreads = {fresh, initialize, list, get, save, remove, clean, title};
})();
