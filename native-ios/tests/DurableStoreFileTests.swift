import Foundation

func check(_ ok: Bool, _ what: String) { print(ok ? "ok   \(what)" : "FAIL \(what)"); if !ok { exit(1) } }

let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ds-\(UUID().uuidString)")
var store = DurableStore(directory: dir)

// Same encoding as DurableStorePlugin.java.
check(DurableStore.encode("handcash.brc100.vault.v1") == "handcash.brc100.vault.v1", "plain key encodes as itself")
check(DurableStore.encode("a b/é") == "a%20b%2F%C3%A9", "non-plain bytes as %XX")
check(DurableStore.encode(".hidden") == "%2Ehidden", "leading dot escaped")
check(DurableStore.encode("h-x") == "%68-x", "h- prefix escaped")
check(DurableStore.decode("a%20b%2F%C3%A9") == "a b/é", "decode reverses encode")
check(DurableStore.decode("bad%2") == nil, "truncated escape refused")

check(store.get("handcash.x") == nil, "missing key reads nil")
check(store.set("handcash.x", "1", allowVaultIdentityReplace: false), "set coalesced key")
check(store.get("handcash.x") == "1", "read back from cache")
store.drain()
store = DurableStore(directory: dir)
check(store.get("handcash.x") == "1", "coalesced write survives a new process")

let vaultA = #"{"identityKey":"02aa","v":1}"#
let vaultA2 = #"{"identityKey":"02aa","v":2}"#
let vaultB = #"{"identityKey":"03bb","v":1}"#
check(store.set("handcash.brc100.vault.v1", vaultA, allowVaultIdentityReplace: false), "first vault write")
check(FileManager.default.fileExists(atPath: dir.appendingPathComponent("handcash.brc100.vault.v1").path), "vault committed to disk synchronously")
check(store.set("handcash.brc100.vault.v1", vaultA2, allowVaultIdentityReplace: false), "same identity may update")
check(!store.set("handcash.brc100.vault.v1", vaultB, allowVaultIdentityReplace: false), "other identity refused")
check(store.get("handcash.brc100.vault.v1") == vaultA2, "refused write left vault intact")
check(store.set("handcash.brc100.vault.v1", vaultB, allowVaultIdentityReplace: true), "recovery may replace identity")
check(store.get("handcash.brc100.vault.backup.v1") == vaultA2, "replaced vault archived as backup")
check(!store.set("handcash.brc100.vault.v1", "not json", allowVaultIdentityReplace: true), "unparseable vault refused")
for _ in 0..<12 { _ = store.set("handcash.brc100.vault.v1", #"{"identityKey":"03bb","v":\#(UUID().uuidString.hashValue)}"#, allowVaultIdentityReplace: false); usleep(2000) }
check(store.keys().filter { $0.hasPrefix("handcash.brc100.vault.history.") }.count == 10, "vault history capped at ten")

let long = "handcash." + String(repeating: "k", count: 300)
check(store.set(long, "v", allowVaultIdentityReplace: false), "long key set")
store.drain()
store = DurableStore(directory: dir)
check(store.keys().contains(long), "hashed long key listed by its name")
check(store.get(long) == "v", "hashed long key reads back")
check(store.remove(long), "remove long key")
check(!store.keys().contains(long) && store.get(long) == nil, "removed key gone")
check(store.set("handcash.y", "", allowVaultIdentityReplace: false) && store.get("handcash.y") == nil, "empty value deletes")
check(!(try! FileManager.default.contentsOfDirectory(atPath: dir.path)).contains { $0.hasSuffix(".tmp") }, "no temp files left")
print("all durable store checks passed")
