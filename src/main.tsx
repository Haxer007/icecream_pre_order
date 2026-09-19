import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Heart,
  IceCreamBowl,
  IceCreamCone,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  ENDPOINT,
  type Order,
  type Store,
  StockError,
  OrderDeletedError,
  SlotValidationError,
  type SlotAddition,
  deleteOrder,
  increaseSlots,
  readPendingSlots,
  savePendingSlots,
  clientId,
  emptyStore,
  loadStore,
  readCache,
  readPending,
  remaining,
  reserve,
  saveCache,
  savePending,
  setServed,
} from "./store";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./styles.css";

function useOrders() {
  const [data, setData] = useState<Store>(() => readCache() || emptyStore());
  const [connection, setConnection] = useState<"loading" | "live" | "offline">(
    "loading",
  );
  const [connectionError, setConnectionError] = useState("");
  const refreshId = useRef(0);
  const apply = (next: Store) => {
    refreshId.current++;
    setData(next);
    saveCache(next);
    setConnection("live");
  };
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const id = ++refreshId.current;
      try {
        const next = await loadStore();
        if (alive && id === refreshId.current) {
          setData(next);
          saveCache(next);
          setConnection("live");
        }
      } catch (err) {
        if (alive && id === refreshId.current) {
          setConnection("offline");
          setConnectionError(
            err instanceof Error
              ? err.message
              : "The connection is temporarily unavailable.",
          );
        }
      }
    };
    void refresh();
    const events = new EventSource(ENDPOINT);
    events.addEventListener("put", refresh);
    events.addEventListener("patch", refresh);
    events.addEventListener("cancel", () => {
      if (alive) setConnection("offline");
    });
    events.onerror = () => {
      if (alive) setConnection("offline");
    };
    const interval = setInterval(refresh, 20000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      events.close();
      clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return { data, connection, connectionError, apply };
}

type Connection = "loading" | "live" | "offline";
function ConnectionLabel({ connection }: { connection: Connection }) {
  return (
    <span className={`connection ${connection}`}>
      <span />
      {connection === "live"
        ? "Updated live"
        : connection === "loading"
          ? "Connecting…"
          : "Reconnecting…"}
    </span>
  );
}
function Brand() {
  return (
    <a href="#" className="brand" aria-label="Scoops and Scripture home">
      <span className="brand-icon">
        <IceCreamCone size={25} strokeWidth={1.65} />
      </span>
      <span>
        Scoops <span className="brand-amp">&</span> Scripture
        <small>A LITTLE SCOOP OF BLESSING</small>
      </span>
    </a>
  );
}
function App() {
  const { data, connection, connectionError, apply } = useOrders();
  const [admin, setAdmin] = useState(location.hash === "#admin");
  const [myId] = useState(clientId);
  useEffect(() => {
    const change = () => {
      setAdmin(location.hash === "#admin");
      if (location.hash === "#admin" || location.hash === "")
        window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#little-inspiration">
              A little inspiration <Heart size={13} />
            </a>
          </nav>
          <a href={admin ? "#" : "#admin"} className="admin-link">
            {admin ? <ArrowLeft size={14} /> : <LockKeyhole size={14} />}
            {admin ? "Back to scoops" : "Serving team"}
            <ChevronRight size={14} />
          </a>
        </div>
      </header>
      {connection === "offline" && (
        <div className="connection-alert" role="status">
          <WifiOff size={15} />
          <span>
            {connectionError ||
              "The live connection was interrupted. Reconnecting automatically."}{" "}
            Reservations will resume when connected.
          </span>
        </div>
      )}
      {admin ? (
        <Admin data={data} connection={connection} apply={apply} />
      ) : (
        <Customer
          data={data}
          connection={connection}
          apply={apply}
          myId={myId}
        />
      )}
      <footer>
        <Brand />
        <p>
          Made with love. Shared with joy. <Heart size={14} />
        </p>
        <a href="#admin">
          <LockKeyhole size={13} /> Serving team access
        </a>
      </footer>
    </>
  );
}

function Customer({
  data,
  connection,
  apply,
  myId,
}: {
  data: Store;
  connection: Connection;
  apply: (data: Store) => void;
  myId: string;
}) {
  const available = remaining(data);
  const [pending, setPending] = useState<Order | null>(readPending);
  const [name, setName] = useState(pending?.name || "");
  const [verse, setVerse] = useState(pending?.verse || "");
  const [quantity, setQuantity] = useState(pending?.quantity || 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<Order | null>(null);
  const myOrders = Object.values(data.orders)
    .filter((order) => order.clientId === myId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const confirmedSuccess = success ? data.orders[success.id] || null : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!pending && (!name.trim() || !verse.trim())) {
      setError("Please enter your name and a Bible verse, not just spaces.");
      return;
    }
    const order = pending || {
      id: crypto.randomUUID(),
      clientId: myId,
      name: name.trim(),
      verse: verse.trim(),
      quantity,
      createdAt: Date.now(),
      served: false,
    };
    setError("");
    setBusy(true);
    setPending(order);
    savePending(order);
    try {
      const next = await reserve(order);
      apply(next);
      setSuccess(next.orders[order.id]);
      setPending(null);
      savePending(null);
    } catch (err) {
      if (err instanceof StockError || err instanceof OrderDeletedError) {
        setPending(null);
        savePending(null);
        void loadStore()
          .then(apply)
          .catch(() => {});
      }
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <section className="hero-section page-width">
        <div className="hero-story">
          <div className="eyebrow">
            <span />
            <span>HOMEMADE HAPPINESS, CHURCH-FAMILY STYLE</span>
          </div>
          <h1>
            A little sweetness.
            <br />
            <span>A lot of love.</span>
            <Sparkles className="title-sparkle" size={34} strokeWidth={1.3} />
          </h1>
          <p className="hero-description">
            Good ice cream brings us together. A good verse lifts us up.
            <br className="desktop-break" /> Reserve your scoop, share a little
            scripture, and let us
            <br className="desktop-break" /> serve you something sweet.
          </p>
          <div className="hero-photo">
            <img
              src="/icecream-hero.webp"
              alt="Pink and vanilla ice cream scoops in a little paper cup, with sprinkles and a wooden spoon"
            />
            <div className="photo-tag">
              <Heart size={14} fill="currentColor" /> Made with love, just for
              you
            </div>
            <div className="round-seal">
              <span>SMALL BATCH</span>
              <IceCreamBowl size={31} strokeWidth={1.5} />
              <span>BIG BLESSINGS</span>
            </div>
            <span className="image-caption">A little serving inspiration</span>
          </div>
          <div className="stock-card">
            <div className="stock-icon">
              <IceCreamBowl size={24} strokeWidth={1.7} />
            </div>
            <div className="stock-copy">
              <strong>
                {connection !== "live" ? (
                  "Checking the freezer…"
                ) : (
                  <>
                    <span className="stock-number">{available}</span> of{" "}
                    {data.capacity} ice creams left
                  </>
                )}
              </strong>
              <span>
                {available === 0
                  ? "Every scoop has found a happy home."
                  : "A small batch. A whole lot of happiness."}
              </span>
            </div>
            <ConnectionLabel connection={connection} />
            <div className="stock-track">
              <span
                style={{ width: `${(available / data.capacity) * 100}%` }}
              />
            </div>
          </div>
        </div>
        <div className="order-column" id="reserve">
          <div className="order-card">
            {confirmedSuccess ? (
              <div className="success-view" role="status">
                <div className="success-icon">
                  <CheckCircle2 size={38} />
                </div>
                <span className="eyebrow">A LITTLE JOY, RESERVED</span>
                <h2>You're on the list!</h2>
                <p>
                  Thank you, <strong>{confirmedSuccess.name}</strong>. We've
                  saved{" "}
                  {confirmedSuccess.quantity === 1
                    ? "an ice cream"
                    : `${confirmedSuccess.quantity} ice creams`}{" "}
                  just for you.
                </p>
                <div className="reservation-ticket">
                  <span>YOUR RESERVATION</span>
                  <strong>
                    #{confirmedSuccess.id.slice(0, 6).toUpperCase()}
                  </strong>
                  <div>
                    <IceCreamBowl size={17} /> {confirmedSuccess.quantity} ice
                    cream{confirmedSuccess.quantity > 1 ? "s" : ""}
                    <span
                      className={`status-pill ${confirmedSuccess.served ? "served" : ""}`}
                    >
                      {confirmedSuccess.served
                        ? "Served"
                        : "Waiting to be served"}
                    </span>
                  </div>
                </div>
                <p className="success-help">
                  When you're ready, give your name to the serving team. We'll
                  take it from the freezer and serve it with a smile.
                </p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setSuccess(null);
                    setVerse("");
                    setQuantity(1);
                  }}
                >
                  {available > 0
                    ? "Reserve a little more"
                    : "Back to reservations"}
                  <ArrowRight size={18} />
                </button>
                <span className="small-note">
                  Your reservation is saved. No need to submit again.
                </span>
              </div>
            ) : (
              <>
                <div className="form-eyebrow">
                  <span className="mini-icon">
                    <IceCreamCone size={18} />
                  </span>{" "}
                  YOUR NEXT HAPPY MOMENT
                </div>
                <h2>Save me a scoop!</h2>
                <p className="form-intro">
                  A name, a verse, and a little anticipation.
                </p>
                <div className="form-divider" />
                {success && !confirmedSuccess && (
                  <div className="notice warning" role="status">
                    Your reservation was deleted by the serving team. Please
                    speak to them if you need help, or make a new reservation
                    below.
                  </div>
                )}
                {connection === "offline" && (
                  <div className="notice warning" role="status">
                    <WifiOff size={17} />
                    <span>
                      We're reconnecting. The count may be out of date;
                      reservations are only confirmed online.
                    </span>
                  </div>
                )}
                {available === 0 && !pending && (
                  <div className="notice sold-out">
                    <Heart size={18} />
                    <span>
                      <strong>That's a wrap for this batch!</strong> All{" "}
                      {data.capacity} ice creams are reserved or served. Thank
                      you for sharing the joy.
                    </span>
                  </div>
                )}
                {pending && !busy && (
                  <div className="notice">
                    <RefreshCw size={17} />
                    <span>
                      You have an unconfirmed reservation. Retry below to check
                      it safely—your order won't be counted twice.
                    </span>
                  </div>
                )}
                <form onSubmit={submit}>
                  <fieldset disabled={busy || !!pending || available === 0}>
                    <label htmlFor="name">
                      Your name <span>*</span>
                    </label>
                    <div className="input-wrap">
                      <Users size={17} />
                      <input
                        id="name"
                        name="name"
                        placeholder="What should we call you?"
                        autoComplete="name"
                        required
                        maxLength={80}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="label-row">
                      <label htmlFor="verse">
                        A Bible verse you love <span>*</span>
                      </label>
                      <BookOpen size={16} />
                    </div>
                    <textarea
                      id="verse"
                      name="verse"
                      placeholder={
                        "“Let all that you do be done in love.”\n— 1 Corinthians 16:14"
                      }
                      required
                      maxLength={1500}
                      value={verse}
                      onChange={(e) => setVerse(e.target.value)}
                      rows={4}
                      dir="auto"
                    />
                    <p className="field-hint">
                      <span className="language-symbol">
                        A<span>अ</span>
                      </span>{" "}
                      Any language. Every word is welcome.
                    </p>
                    <div className="quantity-row">
                      <div>
                        <label htmlFor="quantity">How many happy scoops?</label>
                        <p>Sharing is caring. You're welcome to more.</p>
                      </div>
                      <div className="quantity-control">
                        <button
                          type="button"
                          aria-label="One fewer ice cream"
                          disabled={quantity <= 1}
                          onClick={() => setQuantity((n) => n - 1)}
                        >
                          <Minus size={16} />
                        </button>
                        <output id="quantity" aria-live="polite">
                          {quantity}
                        </output>
                        <button
                          type="button"
                          aria-label="One more ice cream"
                          disabled={quantity >= available}
                          onClick={() => setQuantity((n) => n + 1)}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  </fieldset>
                  {error && (
                    <div className="notice error" role="alert">
                      {error}
                    </div>
                  )}
                  <button
                    className="primary-button reserve-button"
                    type="submit"
                    disabled={
                      busy ||
                      connection !== "live" ||
                      (!pending && available === 0)
                    }
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={18} /> Reserving
                        your happiness…
                      </>
                    ) : pending ? (
                      <>
                        Retry reservation <RefreshCw size={18} />
                      </>
                    ) : available === 0 ? (
                      "All scooped up!"
                    ) : (
                      <>
                        Reserve my ice cream <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  <div className="reservation-note">
                    <ShieldCheck size={15} />
                    <span>We'll keep it frozen until you're ready.</span>
                  </div>
                  <p className="privacy-note">
                    Names & verses are saved online and on this browser. Please
                    don't share sensitive information.
                  </p>
                </form>
              </>
            )}
          </div>
          <div className="below-card">
            <Heart size={15} /> One church family. Many reasons to smile.
          </div>
        </div>
      </section>
      {myOrders.length > 0 && (
        <section className="my-orders page-width">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SAVED ON THIS BROWSER</span>
              <h2>Your little moments of joy</h2>
            </div>
            <span>
              {myOrders.length} reservation{myOrders.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="my-order-list">
            {myOrders.map((order) => (
              <div className="my-order" key={order.id}>
                <div className="stock-icon">
                  <IceCreamBowl size={22} />
                </div>
                <div>
                  <strong>{order.name}</strong>
                  <p>
                    {order.quantity} ice cream{order.quantity > 1 ? "s" : ""}{" "}
                    <span>· #{order.id.slice(0, 6).toUpperCase()}</span>
                  </p>
                </div>
                <span className={`status-pill ${order.served ? "served" : ""}`}>
                  {order.served ? (
                    <CheckCheck size={13} />
                  ) : (
                    <Clock3 size={13} />
                  )}
                  {order.served ? "Served with love" : "Waiting to be served"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="how-section page-width" id="how-it-works">
        <div className="section-title">
          <span className="eyebrow">
            A SCOOP IS JUST THREE LITTLE STEPS AWAY
          </span>
          <h2>Simple as one, two, sweet.</h2>
        </div>
        <div className="steps">
          <div className="step">
            <span className="step-icon">
              <BookOpen size={23} />
              <i>01</i>
            </span>
            <div>
              <h3>Share a little of you</h3>
              <p>
                Tell us your name and a Bible verse
                <br />
                that brings you joy, in any language.
              </p>
            </div>
          </div>
          <ArrowRight className="step-arrow" size={22} />
          <div className="step">
            <span className="step-icon">
              <IceCreamBowl size={24} />
              <i>02</i>
            </span>
            <div>
              <h3>We'll save your scoop</h3>
              <p>
                Your ice cream stays in the freezer,
                <br />
                ready for your happy moment.
              </p>
            </div>
          </div>
          <ArrowRight className="step-arrow" size={22} />
          <div className="step">
            <span className="step-icon">
              <Heart size={24} />
              <i>03</i>
            </span>
            <div>
              <h3>Come, collect & enjoy</h3>
              <p>
                Give your name to our serving team.
                <br />
                We'll take care of the sweetness.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="inspiration page-width" id="little-inspiration">
        <Leaf className="verse-leaf left-leaf" size={78} strokeWidth={0.75} />
        <BookOpen size={22} strokeWidth={1.4} />
        <blockquote>“Taste and see that the Lord is good.”</blockquote>
        <span>PSALM 34:8</span>
        <Leaf className="verse-leaf right-leaf" size={78} strokeWidth={0.75} />
      </section>
      <div className="community-note page-width">
        <Heart size={14} />
        <p>
          A church-family treat, lovingly made to share.{" "}
          <span>
            Please ask the serving team about ingredients & allergens.
          </span>
        </p>
      </div>
    </main>
  );
}

function Admin({
  data,
  connection,
  apply,
}: {
  data: Store;
  connection: Connection;
  apply: (data: Store) => void;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "waiting" | "served">("waiting");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pendingSlots, setPendingSlots] = useState<SlotAddition | null>(
    readPendingSlots,
  );
  const [slotQuantity, setSlotQuantity] = useState(
    String(pendingSlots?.quantity || 5),
  );
  const [slotError, setSlotError] = useState("");
  const [slotMessage, setSlotMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const currentDeleteTarget = deleteTarget
    ? data.orders[deleteTarget.id] || deleteTarget
    : null;
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (!dialog) return;
    if (deleteTarget && !dialog.open) dialog.showModal();
    if (!deleteTarget && dialog.open) dialog.close();
  }, [deleteTarget, unlocked]);

  async function addSlots(event: React.FormEvent) {
    event.preventDefault();
    if (busy || connection !== "live") return;
    const quantity = Number(slotQuantity);
    if (
      !pendingSlots &&
      (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000)
    ) {
      setSlotError("Enter a whole number from 1 to 1,000 slots.");
      return;
    }
    const addition = pendingSlots || { id: crypto.randomUUID(), quantity };
    setBusy("add-slots");
    setSlotError("");
    setSlotMessage("");
    setPendingSlots(addition);
    savePendingSlots(addition);
    try {
      const next = await increaseSlots(addition);
      apply(next);
      setPendingSlots(null);
      savePendingSlots(null);
      setSlotMessage(
        `${addition.quantity} slot${addition.quantity === 1 ? "" : "s"} added. ${remaining(next)} available out of ${next.capacity} total.`,
      );
    } catch (err) {
      if (err instanceof SlotValidationError) {
        setPendingSlots(null);
        savePendingSlots(null);
      }
      setSlotError(
        err instanceof Error
          ? err.message
          : "Could not confirm the added slots. Please retry.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || busy || connection !== "live") return;
    setBusy(deleteTarget.id);
    setDeleteError("");
    try {
      apply(await deleteOrder(deleteTarget.id));
      setDeleteTarget(null);
      setError("");
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Could not confirm deletion. Retrying won't release slots twice.",
      );
    } finally {
      setBusy(null);
    }
  }
  const orders = Object.values(data.orders).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const waiting = orders.filter((order) => !order.served);
  const servedCount =
    (data.deletedServedQuantity || 0) +
    orders
      .filter((order) => order.served)
      .reduce((sum, order) => sum + order.quantity, 0);
  const filtered = orders.filter(
    (order) =>
      (filter === "all" ||
        (filter === "served" ? order.served : !order.served)) &&
      `${order.name} ${order.verse} ${order.id.slice(0, 6)}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  async function toggle(order: Order) {
    if (busy) return;
    setBusy(order.id);
    setError("");
    try {
      apply(await setServed(order.id, !order.served));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update this order. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  if (!unlocked)
    return (
      <main className="login-main">
        <a href="#" className="text-link">
          <ArrowLeft size={15} /> Back to the sweet stuff
        </a>
        <div className="login-card">
          <span className="login-icon">
            <LockKeyhole size={27} strokeWidth={1.6} />
          </span>
          <span className="eyebrow">A LITTLE BEHIND-THE-SCOOPS</span>
          <h1>Hello, serving team.</h1>
          <p>
            A little care makes every scoop special.
            <br />
            Sign in to look after today's reservations.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password === "JesusSavedMe") {
                setUnlocked(true);
                setPassword("");
                setAuthError("");
              } else
                setAuthError("That password doesn’t match. Please try again.");
            }}
          >
            <label htmlFor="password">Team password</label>
            <input
              autoFocus
              type="password"
              id="password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {authError && (
              <p className="auth-error" role="alert">
                {authError}
              </p>
            )}
            <button className="primary-button" type="submit">
              Open serving dashboard <ArrowRight size={18} />
            </button>
          </form>
          <p className="security-note">
            <ShieldCheck size={14} /> Team access only. This is a simple
            frontend lock, not a secure sign-in.
          </p>
        </div>
      </main>
    );
  return (
    <main className="admin-main page-width">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">THE LITTLE SERVING STATION</span>
          <h1>Good things are waiting.</h1>
          <p>Names, verses, and scoops to share. Let's make someone's day.</p>
        </div>
        <button className="secondary-button" onClick={() => setUnlocked(false)}>
          <LogOut size={15} /> Lock dashboard
        </button>
      </div>
      <div className="admin-stats">
        <div>
          <span>
            Available to reserve <IceCreamBowl size={20} />
          </span>
          <strong>
            {remaining(data)}
            <small> / {data.capacity}</small>
          </strong>
          <ConnectionLabel connection={connection} />
        </div>
        <div>
          <span>
            Waiting to be served <Clock3 size={20} />
          </span>
          <strong>
            {waiting.reduce((sum, order) => sum + order.quantity, 0)}
          </strong>
          <p>
            {waiting.length} reservation{waiting.length === 1 ? "" : "s"} in the
            queue
          </p>
        </div>
        <div>
          <span>
            Served with love <CheckCheck size={20} />
          </span>
          <strong>{servedCount}</strong>
          <p>Happy scoops, happy hearts</p>
        </div>
      </div>
      <section className="inventory-panel" aria-labelledby="inventory-title">
        <div className="inventory-panel-heading">
          <span className="stock-icon">
            <Plus size={22} />
          </span>
          <div>
            <h2 id="inventory-title">A little more to share</h2>
            <p>More ice creams ready? Add slots for everyone to reserve.</p>
          </div>
        </div>
        <form className="inventory-form" onSubmit={addSlots}>
          <div>
            <label htmlFor="slot-quantity">Slots to add</label>
            <input
              id="slot-quantity"
              type="number"
              inputMode="numeric"
              min="1"
              max="1000"
              step="1"
              required
              value={slotQuantity}
              disabled={!!busy || !!pendingSlots || connection !== "live"}
              onChange={(event) => {
                setSlotQuantity(event.target.value);
                setSlotMessage("");
              }}
              aria-describedby="slot-help"
            />
          </div>
          <button
            type="submit"
            className="primary-button"
            disabled={!!busy || connection !== "live"}
          >
            {busy === "add-slots" ? (
              <LoaderCircle size={16} className="spin" />
            ) : pendingSlots ? (
              <RefreshCw size={16} />
            ) : (
              <Plus size={16} />
            )}
            {pendingSlots ? "Retry adding slots" : "Add slots"}
          </button>
        </form>
        <p id="slot-help" className="inventory-help">
          Only add ice creams that are ready to serve. This increases the total;
          it doesn't reset existing orders.
        </p>
        {pendingSlots && !busy && (
          <div className="notice" role="status">
            An addition of {pendingSlots.quantity} slots needs confirmation.
            Retry safely—even after a reload, these slots won't be added twice.
          </div>
        )}
        {slotError && (
          <div className="notice error" role="alert">
            {slotError}
          </div>
        )}
        {slotMessage && (
          <div className="inventory-success" role="status">
            <CheckCircle2 size={16} />
            {slotMessage}
          </div>
        )}
      </section>
      {connection !== "live" && (
        <div className="notice warning">
          <WifiOff size={17} />
          {connection === "loading"
            ? "Connecting to the reservation list…"
            : "Connection lost. Showing the last saved list; updates are paused until we reconnect."}
        </div>
      )}
      <section className="admin-orders">
        <div className="orders-toolbar">
          <div className="filter-tabs" aria-label="Filter orders">
            {(["waiting", "served", "all"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={filter === value ? "active" : ""}
              >
                {value === "all"
                  ? "All orders"
                  : value === "waiting"
                    ? "Waiting"
                    : "Served"}
                <span>
                  {value === "all"
                    ? orders.length
                    : orders.filter((o) =>
                        value === "served" ? o.served : !o.served,
                      ).length}
                </span>
              </button>
            ))}
          </div>
          <div className="admin-search">
            <Search size={16} />
            <input
              aria-label="Search by name, Bible verse or reservation code"
              placeholder="Find a name or verse…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="queue-label">
          <span>
            <ArrowDown size={13} /> First come, first served
          </span>
          <span>
            {filtered.length} reservation{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        {!filtered.length ? (
          <div className="empty-state">
            <IceCreamBowl size={40} strokeWidth={1.2} />
            <h2>
              {query
                ? "No matching reservations"
                : filter === "waiting"
                  ? "All caught up. How sweet!"
                  : filter === "served"
                    ? "The sweetness is still to come."
                    : "A fresh start, a full freezer."}
            </h2>
            <p>
              {query
                ? "Try a different name, verse, or reservation code."
                : filter === "waiting"
                  ? "New reservations will appear here automatically."
                  : filter === "served"
                    ? "Orders you mark as served will appear here."
                    : "Your first reservation will appear here automatically."}
            </p>
            {query && (
              <button className="secondary-button" onClick={() => setQuery("")}>
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="admin-order-list">
            {filtered.map((order) => (
              <article
                key={order.id}
                className={`admin-order ${order.served ? "is-served" : ""}`}
              >
                <div className="order-person">
                  <span className="avatar">
                    {Array.from(order.name)[0]?.toUpperCase()}
                  </span>
                  <div>
                    <h3>{order.name}</h3>
                    <p>
                      #{order.id.slice(0, 6).toUpperCase()} <span>·</span>{" "}
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className="order-quantity">
                    <IceCreamBowl size={17} /> {order.quantity}
                  </span>
                </div>
                <blockquote dir="auto">{order.verse}</blockquote>
                <div className="admin-order-bottom">
                  <span
                    className={`status-pill ${order.served ? "served" : ""}`}
                  >
                    {order.served ? (
                      <CheckCheck size={13} />
                    ) : (
                      <Clock3 size={13} />
                    )}
                    {order.served ? "Served with love" : "Waiting to be served"}
                  </span>
                  <div className="order-actions">
                    <button
                      type="button"
                      className="delete-order-button"
                      aria-label={`Delete order for ${order.name}`}
                      title="Delete order"
                      disabled={!!busy || connection !== "live"}
                      onClick={() => {
                        setDeleteTarget(order);
                        setDeleteError("");
                      }}
                    >
                      <Trash2 size={15} />
                      <span>Delete</span>
                    </button>
                    <button
                      disabled={!!busy || connection !== "live"}
                      className={order.served ? "undo-button" : "serve-button"}
                      onClick={() => void toggle(order)}
                    >
                      {busy === order.id ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : order.served ? (
                        <RefreshCw size={14} />
                      ) : (
                        <Check size={15} />
                      )}
                      {order.served ? "Mark as waiting" : "Mark as served"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <dialog
        className="delete-dialog"
        ref={deleteDialog}
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setDeleteTarget(null);
        }}
      >
        {currentDeleteTarget && (
          <>
            <span className="delete-dialog-icon">
              <Trash2 size={25} />
            </span>
            <span className="eyebrow">PLEASE DOUBLE-CHECK</span>
            <h2 id="delete-title">Delete this reservation?</h2>
            <p className="delete-person">
              {currentDeleteTarget.name} · {currentDeleteTarget.quantity} ice
              cream{currentDeleteTarget.quantity === 1 ? "" : "s"}
            </p>
            <p id="delete-description">
              The name and verse will be permanently removed.{" "}
              {currentDeleteTarget.served
                ? "This order is already served, so its ice creams stay counted as consumed. No slots will be returned."
                : `${currentDeleteTarget.quantity} slot${currentDeleteTarget.quantity === 1 ? "" : "s"} will become available again if this order is still waiting.`}
            </p>
            <p className="delete-caution">This cannot be undone.</p>
            {deleteError && (
              <div className="notice error" role="alert">
                {deleteError}
              </div>
            )}
            <div className="dialog-actions">
              <button
                autoFocus
                className="secondary-button"
                disabled={!!busy}
                onClick={() => setDeleteTarget(null)}
              >
                Keep order
              </button>
              <button
                className="danger-button"
                disabled={!!busy || connection !== "live"}
                onClick={() => void confirmDelete()}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Delete order
              </button>
            </div>
          </>
        )}
      </dialog>
      <p className="admin-footnote">
        <ShieldCheck size={14} /> Marking an order served doesn't change
        available stock. Scoops are reserved when an order is placed.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
