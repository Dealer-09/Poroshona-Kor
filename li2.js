function styler(u,l,d){return s=>[...s].map(ch=>{const c=ch.codePointAt(0);
 if(c>=65&&c<=90)return String.fromCodePoint(u+(c-65));
 if(c>=97&&c<=122)return String.fromCodePoint(l+(c-97));
 if(d&&c>=48&&c<=57)return String.fromCodePoint(d+(c-48));return ch;}).join('');}
const it=styler(0x1D608,0x1D622,null);
const bd=styler(0x1D400,0x1D41A,0x1D7CE);
const bi=styler(0x1D468,0x1D482,null);

const L=[];
L.push("Hello connections,");L.push("");
L.push(it("It started with a sentence my mother has said my whole life: Poroshona Kor. (Go and study.)"));L.push("");
L.push(it("I sit down for one lecture, and twenty minutes later I am three gaming videos deep with no memory of how I got there. The drift is silent, and by the time you notice, the hour is gone."));L.push("");
L.push(it("Willpower does not help, because autopilot never announces itself. And a blocker that bans YouTube is useless when the lecture itself lives on YouTube."));L.push("");
L.push(it("So I kept asking: what if something could catch the drift before autopilot locks in, and pull me back before I was gone?"));L.push("");
L.push("That question is why I built "+bd("Poroshona Kor")+".");L.push("");
L.push(bd("Poroshona Kor")+" is a browser-first focus system that reads your real-time behaviour against the intent you declared, predicts doomscroll onset before it happens, and steps in during the drift, not after.");L.push("");
L.push(it("The name is Bengali for \"Go and Study\", what my mother says when she catches me drifting. I built it to be that voice, for myself."));L.push("");
L.push(bi("What It Actually Does:"));
L.push("• "+bd("Intent-Aware Drift Scoring:")+" you declare why you opened the browser (study, tutorial, work), and a penalty matrix weighs scroll speed, tab-switching, passive vs active time and infinite-scroll resets against it, so a lecture is forgiven and a gaming binge during study is not.");
L.push("• "+bd("AI Content Classification:")+" every page is classified (lecture, reading, gaming, social), so the score knows a coding tutorial from a Twitch stream on the same domain.");
L.push("• "+bd("Forward-Looking Onset Prediction:")+" a trajectory model, backed by a trained LSTM, reads the rate-of-change of drift to flag autopilot ~5 minutes before it locks in.");
L.push("• "+bd("Real-Time Interventions:")+" cooldown-gated nudges, pauses and reflection prompts fire only when you are truly drifting, never while you type, never during a Pomodoro break.");
L.push("• "+bd("Reflection Coach & Analytics:")+" an AI coach and a dashboard that correlate your mood with your focus, so you see the pattern instead of feeling guilty about it.");
L.push("");
L.push(it("I did not build a blocker. I built the small nudge that catches me in the two minutes before I am gone, so that \"go and study\" finally comes from inside the browser, not the other room."));L.push("");
L.push("GitHub: https://github.com/Dealer-09/Poroshona-Kor");

const out=L.join("\n");
console.log(out);
console.error("\n----- LENGTH -----");
console.error("LinkedIn count (UTF-16 units):",out.length,"| room left:",3000-out.length);
