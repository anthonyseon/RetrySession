// Launcher.cs - source for start.exe, the ONLY executable: the double-clickable
// entry point, and (with --hidden) the windowless launcher the scheduled tasks use.
//
// Why an .exe at all
//   Double-clicking a .ps1 opens it in an editor, it does not run. A .bat/.cmd
//   runs it but through a console window. Since 2026-10-02 a person DOES use
//   start.bat / stop.bat (user request: two plain files in git that work right
//   after a clone, and whose console shows progress and errors). But nothing
//   long-lived may sit under cmd.exe, and the scheduled tasks need a launcher
//   that never creates a console at all - that is this exe (see --hidden below).
//
// Why it is built from source instead of committed as a binary
//   Built with csc.exe, which ships with Windows (.NET Framework 4.x) - no
//   toolchain to install, matching this project's zero-dependency rule. The
//   binary is a build artifact and stays out of git; scripts/build-exe.ps1
//   regenerates it in about a second.
//
// Built with /target:winexe so no console window is ever created.
//
// Behaviour
//   start.exe                -> runs start.ps1 hidden; the app window appears
//   start.exe -Install ...   -> shows the PowerShell window so output is readable
//   start.exe --hidden <program> [args...]
//                            -> start a console program with NO window, wait for it,
//                               and return its exit code (see RunHidden below)
//   Every other argument is forwarded to start.ps1 unchanged.
//
// Why one executable (user request 2026-10-02)
//   There used to be two: start.exe (for people) and runhidden.exe (for the
//   scheduled tasks). People asked which one is "the" program. Both are tiny
//   windowless launchers built from the same toolchain, so the second became a
//   mode of the first. The --hidden switch is double-dashed on purpose: start.ps1
//   only takes single-dash parameters, so it can never be forwarded by accident.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

internal static class Launcher
{
    // A /target:winexe process starts with no console, so when it is launched
    // FROM a terminal its child's output goes nowhere and the caller sees
    // nothing at all. Measured: `start.exe -Status` printed an empty line.
    // Attaching to the parent's console fixes that without ever creating a
    // console on a plain double-click (there is no parent console then, and
    // AttachConsole simply fails).
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int processId);

    private const int ATTACH_PARENT_PROCESS = -1;

    // 🔴 scripts/launcher-lib.ps1 and src/lib/ready.mjs look for this exact text
    //   inside the built exe to tell a current build from an old one (an old
    //   start.exe would forward "--hidden node.exe ..." to start.ps1 and fail on
    //   every run, silently - the task has no window). test/ascii.test.mjs ties
    //   the three together.
    private const string HiddenSwitch = "--hidden";

    private static int Main(string[] rawArgs)
    {
        // 🔴 Before AttachConsole: the hidden mode must behave exactly like the
        //   old runhidden.exe - no console of its own, nothing attached.
        if (rawArgs.Length > 0 && rawArgs[0] == HiddenSwitch) return RunHidden(rawArgs);

        bool haveConsole = AttachConsole(ATTACH_PARENT_PROCESS);
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(exeDir, "start.ps1");

        if (!File.Exists(script))
        {
            Fail("start.ps1 을 찾을 수 없습니다.\n\n찾은 위치:\n" + script +
                 "\n\nstart.exe 는 RetrySession 폴더 안에 있어야 합니다.");
            return 2;
        }

        // Use the Windows PowerShell that ships with the OS. Resolving it by
        // absolute path rather than trusting PATH: a broken PATH is exactly the
        // kind of situation this tool is supposed to survive.
        string shell = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            @"WindowsPowerShell\v1.0\powershell.exe");

        if (!File.Exists(shell))
        {
            Fail("Windows PowerShell 을 찾을 수 없습니다.\n\n찾은 위치:\n" + shell);
            return 3;
        }

        // Any argument means the user asked for something with output worth
        // reading (-Status, -Install, -Stop). A bare double-click should stay
        // silent and just bring the window up.
        //
        // Where that output goes depends on how we were launched:
        //   from a terminal  -> inherit its console, print there (no new window)
        //   from Explorer    -> open a PowerShell window so it is readable at all
        bool wantOutput = rawArgs.Length > 0;
        bool showWindow = wantOutput && !haveConsole;

        // Relay the child's output ourselves when we have a console to print to.
        //
        // Measured: simply attaching the parent console and letting the child
        // inherit the handles produced NOTHING - not piped, not redirected to a
        // file, not from PowerShell. Reading the streams and writing them to our
        // own Console works in every one of those cases.
        bool relay = rawArgs.Length > 0 && haveConsole;

        var cmd = new StringBuilder();
        cmd.Append("-NoProfile -ExecutionPolicy Bypass ");
        if (!showWindow) cmd.Append("-WindowStyle Hidden ");

        if (relay)
        {
            // 🔴 Force UTF-8 on the child before anything runs.
            //
            // Measured mojibake: PowerShell 5.1 writes redirected output in the
            // OEM codepage (cp949 here) while node writes UTF-8 straight to the
            // same pipe. One stream, two encodings - no single decoder can read
            // it. Setting the child's OutputEncoding makes it all UTF-8, so we
            // decode once and both halves come out right.
            var inner = new StringBuilder();
            inner.Append("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ");
            inner.Append("& '").Append(script.Replace("'", "''")).Append('\'');
            foreach (string a in rawArgs)
            {
                inner.Append(' ').Append(QuoteForPowerShell(a));
            }
            cmd.Append("-Command \"").Append(inner.ToString().Replace("\"", "\\\"")).Append('"');
        }
        else
        {
            cmd.Append("-File \"").Append(script).Append('"');
            foreach (string a in rawArgs)
            {
                string v = a.Replace("\"", "\\\"");
                cmd.Append(' ');
                if (v.IndexOf(' ') >= 0 || v.IndexOf('\t') >= 0) cmd.Append('"').Append(v).Append('"');
                else cmd.Append(v);
            }
        }

        var psi = new ProcessStartInfo
        {
            FileName = shell,
            Arguments = cmd.ToString(),
            WorkingDirectory = exeDir,
            UseShellExecute = false,
            CreateNoWindow = !showWindow,
            WindowStyle = showWindow ? ProcessWindowStyle.Normal : ProcessWindowStyle.Hidden,
            RedirectStandardOutput = relay,
            RedirectStandardError = relay,
        };

        if (relay)
        {
            // The child was told to emit UTF-8 (see the -Command prologue), so
            // decode UTF-8 and print UTF-8. Both halves of the stream - the
            // PowerShell text and the node text - now agree.
            psi.StandardOutputEncoding = new UTF8Encoding(false);
            psi.StandardErrorEncoding = new UTF8Encoding(false);
            try { Console.OutputEncoding = new UTF8Encoding(false); }
            catch { /* some hosts refuse; the decode above still helps */ }
        }

        try
        {
            using (Process p = Process.Start(psi))
            {
                if (relay)
                {
                    // Async on both streams: reading one to completion first can
                    // deadlock when the other fills its pipe buffer.
                    p.OutputDataReceived += (s, e) => { if (e.Data != null) Console.Out.WriteLine(e.Data); };
                    p.ErrorDataReceived += (s, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
                    p.BeginOutputReadLine();
                    p.BeginErrorReadLine();
                }

                // Wait whenever there is output to read; otherwise fire and
                // forget, because the app window is the interface.
                if (!wantOutput) return 0;
                p.WaitForExit();
                Console.Out.Flush();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Fail("start.ps1 실행에 실패했습니다.\n\n" + ex.Message);
            return 1;
        }
    }

    // Quoting for the `-Command` form.
    //
    // 🔴 A switch must stay bare. Measured: emitting '-Status' single-quoted
    // made PowerShell read it as a positional VALUE, which bound to -Port and
    // failed with "cannot convert -Status to System.Int32". Only quote things
    // that actually need it.
    private static string QuoteForPowerShell(string a)
    {
        if (a.Length > 0 && a[0] == '-' && a.IndexOf(' ') < 0 && a.IndexOf('\t') < 0)
        {
            return a;   // a parameter name - pass it through untouched
        }
        return "'" + a.Replace("'", "''") + "'";
    }

    // ---- --hidden: start a console program with no window --------------------
    //
    // Why this exists (measured)
    //   A scheduled task whose action is node.exe gets a real console window under
    //   an interactive logon. The task's own `-Hidden` setting does NOT help - that
    //   flag hides the TASK in the Task Scheduler list, not the process window.
    //   Measured: the UI server (pid 46100) had a conhost.exe child, which is the
    //   window the user kept seeing. The 5-minute monitor flashed one every 5
    //   minutes too. `-WindowStyle Hidden` does not help either: the console is
    //   allocated before PowerShell runs, and on Windows 11 the default console
    //   host is Windows Terminal, whose window that flag does not control
    //   (measured 2026-09-21: the tray showed one all day).
    //
    //   This process has no console of its own (/target:winexe), and it starts the
    //   child with CREATE_NO_WINDOW, so neither process ever shows one.
    //
    // It WAITS for the child and returns its exit code, so Task Scheduler still
    // shows the task as Running while a server runs, and still records a real
    // failure code.
    //
    //   start.exe --hidden <program> [args...]      (no cmd.exe involved)
    //
    // The working directory is inherited from the caller (the task definition
    // sets it), as before.
    private static int RunHidden(string[] args)
    {
        if (args.Length < 2)
        {
            Fail("실행할 프로그램을 지정하지 않았습니다.\n\n사용법:\n  start.exe " + HiddenSwitch + " <program> [args...]");
            return 2;
        }

        string program = args[1];
        if (!File.Exists(program))
        {
            Fail("실행할 프로그램을 찾을 수 없습니다.\n\n" + program);
            return 3;
        }

        var sb = new StringBuilder();
        for (int i = 2; i < args.Length; i++)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(QuoteForWindows(args[i]));
        }

        var psi = new ProcessStartInfo
        {
            FileName = program,
            Arguments = sb.ToString(),
            WorkingDirectory = Directory.GetCurrentDirectory(),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Fail("실행에 실패했습니다.\n\n" + program + "\n\n" + ex.Message);
            return 1;
        }
    }

    // Standard Windows argument quoting: wrap when the value has whitespace or a
    // quote, and double up the backslashes that precede a quote.
    private static string QuoteForWindows(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;

        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in a)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { sb.Append('\\', slashes * 2 + 1).Append('"'); }
            else { sb.Append('\\', slashes).Append(c); }
            slashes = 0;
        }
        sb.Append('\\', slashes * 2).Append('"');
        return sb.ToString();
    }

    // A GUI app has nowhere to print, so failures must be a dialog. Silence
    // would be the worst outcome: the user double-clicks and nothing happens.
    private static void Fail(string message)
    {
        MessageBox.Show(message, "RetrySession", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
