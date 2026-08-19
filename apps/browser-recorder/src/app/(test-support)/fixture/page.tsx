"use client";

import { useState } from "react";

export default function RecorderFixture() {
  const [submitted, setSubmitted] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState("2026-07-21");
  const [delegatedClicks, setDelegatedClicks] = useState(0);
  const navigateSpa = () => {
    history.pushState({ fixture: true }, "", "/fixture?view=details");
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Recorder fixture</h1>
      <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }}>
        <p><label>Email <input name="email" type="email" data-testid="email-input" /></label></p>
        <p><label>Password <input name="password" type="password" autoComplete="current-password" /></label></p>
        <p><label>Appointment date <input name="appointmentDate" type="date" value={appointmentDate} min="2026-07-01" max="2026-08-31" onChange={(event) => setAppointmentDate(event.target.value)} /></label></p>
        <p data-testid="appointment-value">Selected: {appointmentDate}</p>
        <p><label><span data-testid="plan-label">Plan</span> <select name="plan"><option value="free">Free</option><option value="pro">Professional</option></select></label></p>
        <p><label>Construction type <select name="constructionType"><option value="frame">Frame</option><option value="masonry">Masonry</option></select></label></p>
        <p><label>Roof material <select name="roofMaterial"><option value="metal">Metal</option><option value="composition">Composition</option><option value="wood" disabled>Wood</option></select></label></p>
        <p><label>Regions <select name="regions" multiple><option value="west">West</option><option value="east">East</option></select></label></p>
        <p><label><input name="terms" type="checkbox" /> Accept terms</label></p>
        <button type="submit">Continue</button>
      </form>
      {submitted ? <p role="status">Submitted</p> : null}
      <button type="button" onClick={navigateSpa}>Open details</button>
      <button type="button" onClick={() => window.open("/fixture?popup=1", "_blank")}>Open popup</button>
      <input type="button" value="Input action" />
      <div role="button" tabIndex={0}>Role action</div>
      <a href="#fixture-help">Fixture help</a>
      <a href="/fixture?view=linked">Open linked page</a>
      <div role="menuitem" onClick={() => setDelegatedClicks((count) => count + 1)}><span>Quotes menu</span></div>
      <div onClick={() => setDelegatedClicks((count) => count + 1)}><span>Delegated content action</span></div>
      <p data-testid="delegated-clicks">Delegated clicks: {delegatedClicks}</p>
      <iframe title="Payment frame" src="/fixture/frame" style={{ width: "100%", height: 120, marginTop: 20 }} />
    </main>
  );
}
