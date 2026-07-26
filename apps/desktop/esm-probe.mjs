console.log("STEP-1 старт");
const { app } = await import("electron");
console.log("STEP-2 electron ок");
try { await import("socket.io"); console.log("STEP-3 socket.io ок"); } catch (e) { console.log("STEP-3 FAIL: " + String(e.message).slice(0,80)); }
try { await import("ffmpeg-static"); console.log("STEP-4 ffmpeg ок"); } catch (e) { console.log("STEP-4 FAIL: " + String(e.message).slice(0,80)); }
try { await import("@gold-work/core"); console.log("STEP-5 core ок"); } catch (e) { console.log("STEP-5 FAIL: " + String(e.message).slice(0,80)); }
try { await import("@gold-work/shared"); console.log("STEP-6 shared ок"); } catch (e) { console.log("STEP-6 FAIL: " + String(e.message).slice(0,80)); }
app.quit();
