using System.Collections.ObjectModel;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;
using Wpf.Ui.Appearance;

namespace MdReader;

public partial class MainWindow : Wpf.Ui.Controls.FluentWindow
{
    private const string VirtualHost = "app.local";

    /// <summary>
    /// 窗口边缘用于拖拽缩放的边带宽度（DIP）。
    /// 必须与 mainwindow.xaml 中 WebView2 的 Margin 保持一致，原因见 ApplyWindowChrome()。
    /// </summary>
    private const double ResizeBandDip = 4;

    /// <summary>命令行传入、等网页就绪后再注入的文档。</summary>
    private readonly List<string> _pendingFiles = new();

    /// <summary>最近打开的文件（最新在前），持久化在 MdReader-data\recent.json。</summary>
    private List<string> _recent = new();

    /// <summary>标题栏上的文档标签（ItemsControl 的数据源）。</summary>
    private readonly ObservableCollection<DocTabItem> _tabs = new();

    public MainWindow() : this(Array.Empty<string>()) { }

    public MainWindow(string[] openPaths)
    {
        InitializeComponent();
        DocTabs.ItemsSource = _tabs;
        // 拖放仍由网页处理（这样光标是正常的「复制」，不会显示禁止圈）。
        // 磁盘路径改走消息里的 File 对象 —— WebView2 会还原成带 Path 的
        // CoreWebView2File，这是平台给的正路，不需要关掉外部拖放。
        Web.AllowExternalDrop = true;
        _pendingFiles.AddRange(openPaths);
        ApplyInitialSize();
        Loaded += async (_, _) => await InitAsync();
    }

    /// <summary>
    /// 把 XAML 里的设计尺寸收敛到当前屏幕工作区内。
    /// 高 DPI 缩放下 1120×740 DIP 可能已经接近甚至超出工作区（例如 1080p @150%，
    /// 工作区只有约 1280×672 DIP），所以这里按工作区的比例再夹一次。
    /// </summary>
    private void ApplyInitialSize()
    {
        var work = SystemParameters.WorkArea;
        Width = Math.Min(Width, Math.Max(MinWidth, work.Width * 0.90));
        Height = Math.Min(Height, Math.Max(MinHeight, work.Height * 0.88));
    }

    /// <summary>
    /// 重建 WindowChrome，把缩放边带从 Wpf.Ui 默认的 4px 提到 6px。
    ///
    /// 为什么必须重建：Wpf.Ui 的 FluentWindow 在 ExtendsContentIntoTitleBar=true 时
    /// 会把 WindowChrome.ResizeBorderThickness 设成 4px，但 WPF 的 WindowChrome 是靠
    /// 顶层窗口响应 WM_NCHITTEST 来实现「无边框窗口边缘可缩放」的。WebView2 是子 HWND，
    /// 鼠标落在它身上时 WM_NCHITTEST 直接交给它处理并返回 HTCLIENT，顶层窗口收不到消息，
    /// 于是左右下三边完全无法拖拽缩放（只剩标题栏那一条上边缘还能拉）。
    /// 配合 XAML 里 WebView2 的 Margin=6，把 6px 边带留给 WPF 自己，缩放才恢复。
    ///
    /// 调用时机：必须在 Wpf.Ui 的 OnSourceInitialized 之后（即窗口句柄已创建），
    /// 所以放在 Loaded；WPF-UI 不会在之后再次覆盖，这里的本地值最终生效。
    /// </summary>
    private void ApplyWindowChrome()
    {
        WindowChrome.SetWindowChrome(
            this,
            new WindowChrome
            {
                CaptionHeight = 0,
                CornerRadius = default,
                GlassFrameThickness = new Thickness(-1),
                // 判定宽度用 HitBand（6），可视边带仍是 0 —— 两者解耦
                ResizeBorderThickness = new Thickness(HitBand),
                UseAeroCaptionButtons = false,
            });
    }

    /// <summary>
    /// 便携模式的运行时数据根目录：**exe 同级的 MdReader-data/**。
    /// 这样整个解压文件夹拷走即用、删掉即净，不往 %LOCALAPPDATA% 等系统位置写任何东西。
    /// 里面只有两类可再生的派生数据：
    ///   wwwroot\reader.html  —— 每次启动从内嵌资源解压出来的页面
    ///   WebView2\            —— WebView2 用户数据目录（缓存 / localStorage 偏好）
    /// 若 exe 所在目录不可写（例如被放进 Program Files），退回 %LOCALAPPDATA%\MdReader，
    /// 保证程序仍能启动。
    /// </summary>
    /// <summary>
    /// 数据目录固定在**程序目录下的 MdReader-data**，不往解压目录外写任何东西。
    /// 注意：换个目录解压就等于换了数据目录 —— 会话/最近文件不会跟过去，
    /// 这是便携程序应有的行为，测试时请解压到同一个目录。
    /// </summary>
    private static string DataRoot()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "MdReader-data");
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static string WwwRoot()
    {
        var dir = Path.Combine(DataRoot(), "wwwroot");
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>把一条日志追加到 &lt;MdReader-data&gt;/logs/app-yyyy-MM-dd.log。</summary>
    private static void AppendLog(string level, string msg, string? extra = null)
    {
        try
        {
            var dir = Path.Combine(DataRoot(), "logs");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, $"app-{DateTime.Now:yyyy-MM-dd}.log");
            var line = $"{DateTime.Now:HH:mm:ss.fff} [{level}] {msg}" +
                       (string.IsNullOrEmpty(extra) ? "" : $" | {extra}") + Environment.NewLine;
            File.AppendAllText(file, line, new UTF8Encoding(false));
        }
        catch
        {
            // 日志本身绝不能影响主流程
        }
    }

    /// <summary>
    /// 把网页的主题与配色同步到原生标题栏，让它和窗口内部是同一套颜色。
    /// 颜色由网页侧用 getComputedStyle 把 CSS 变量转成 #RRGGBB 再发过来
    /// （WPF 的 ColorConverter 不认 rgb() / color-mix()）。
    /// </summary>
    private void ApplyChromeTheme(string? mode, string? bg, string? fg, string? bd, string? ac, string? win)
    {
        try
        {
            ApplicationThemeManager.Apply(
                mode == "dark" ? ApplicationTheme.Dark : ApplicationTheme.Light);
            // 用替换资源的方式更新配色：XAML 里都是 DynamicResource，会跟着变。
            // 次要文字 / 悬停底色都由前景色派生，不用再往网页侧要两个颜色。
            if (TryColor(bg, out var c))
            {
                Resources["ChromeBg"] = new SolidColorBrush(c);
                TitleCtl.Background = new SolidColorBrush(c);
            }
            if (TryColor(fg, out var f))
            {
                Resources["ChromeFg"] = new SolidColorBrush(f);
                Resources["ChromeMuted"] = new SolidColorBrush(f) { Opacity = 0.62 };
                Resources["ChromeHover"] = new SolidColorBrush(f) { Opacity = 0.10 };
            }
            if (TryColor(bd, out var b)) Resources["ChromeBorder"] = new SolidColorBrush(b);
            // 缩放边带露出的是根 Grid / 窗口的底色。
            // 用**标题栏的实时颜色**（bg = 网页的 --panel）而不是页面底色 ——
            // 边带紧挨着标题栏，同色才不突兀。
            if (TryColor(bg, out var bandColor))
            {
                var band = new SolidColorBrush(bandColor);
                RootGrid.Background = band;
                Background = band;
            }
            if (TryColor(ac, out var a))
            {
                Resources["ChromeAccent"] = new SolidColorBrush(a);
                Resources["ChromeAccentSoft"] = new SolidColorBrush(
                    Color.FromArgb(0x26, a.R, a.G, a.B));
            }
            AppendLog("info", $"标题栏配色已同步: {mode} bg={bg} fg={fg} bd={bd} ac={ac} win={win}");
            // 属性面板里「内置示例」要给具体位置，把程序路径告诉网页
            RunInPage($"window.__exePath = {JsonSerializer.Serialize(Environment.ProcessPath ?? "")}");
        }
        catch (Exception ex)
        {
            AppendLog("warn", "同步标题栏主题失败", ex.Message);
        }
    }

    private static bool TryColor(string? hex, out Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(hex)) return false;
        try
        {
            color = (Color)ColorConverter.ConvertFromString(hex)!;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 拖文件进窗口。**必须由宿主处理**：网页的 File 对象不带磁盘路径
    /// （Chromium 早已移除 File.path，WebView2 也不提供），
    /// 所以把 WebView2 的 AllowExternalDrop 关掉，让拖放落到 WPF 这一层，
    /// 才能从 DataFormats.FileDrop 拿到真实路径。
    /// </summary>
    private void OnFileDragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop)
            ? DragDropEffects.Copy
            : DragDropEffects.None;
        e.Handled = true;
    }

    private async void OnFileDrop(object sender, DragEventArgs e)
    {
        try
        {
            if (!e.Data.GetDataPresent(DataFormats.FileDrop)) return;
            if (e.Data.GetData(DataFormats.FileDrop) is not string[] files) return;
            foreach (var f in files)
            {
                if (!File.Exists(f)) continue;
                if (!f.EndsWith(".md", StringComparison.OrdinalIgnoreCase) &&
                    !f.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase) &&
                    !f.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)) continue;
                AppendLog("info", $"拖入打开 {f}");
                await InjectOpenFileAsync(f);
            }
        }
        catch (Exception ex)
        {
            AppendLog("warn", "拖入打开失败", ex.Message);
        }
        finally
        {
            // 网页那边收不到 drop 事件了，让它把「松开以打开」的提示收掉
            RunInPage("window.__dropDone && window.__dropDone()");
        }
    }

    // ==================== 系统集成：最近文件 / 跳转列表 / 文件关联 ====================
    // 这些都是**网页形态根本做不到**的能力，所以放在原生这一侧，
    // 网页只负责显示文档内容。

    private const string ProgId = "MdReader.Markdown";
    private const string ExtKey = @"Software\Classes\.md";
    private const string ProgKey = @"Software\Classes\" + ProgId;

    private string RecentStore => Path.Combine(DataRoot(), "recent.json");

    private void LoadRecent()
    {
        try
        {
            if (File.Exists(RecentStore))
                _recent = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(RecentStore)) ?? new();
        }
        catch { _recent = new(); }
        _recent.RemoveAll((p) => !File.Exists(p)); // 顺手清掉已经不存在的
    }

    private void RememberRecent(string path)
    {
        try
        {
            _recent.RemoveAll((p) => string.Equals(p, path, StringComparison.OrdinalIgnoreCase));
            _recent.Insert(0, path);
            if (_recent.Count > 12) _recent = _recent.Take(12).ToList();
            File.WriteAllText(RecentStore, JsonSerializer.Serialize(_recent));
            BuildRecentMenu();
            ApplyJumpList();
        }
        catch (Exception ex) { AppendLog("warn", "记录最近文件失败", ex.Message); }
    }

    /// <summary>Windows 任务栏跳转列表里的「最近」。原生能力，网页做不了。</summary>
    private void ApplyJumpList()
    {
        try
        {
            var list = new JumpList { ShowRecentCategory = false, ShowFrequentCategory = false };
            var exe = Environment.ProcessPath;
            foreach (var p in _recent)
            {
                if (!File.Exists(p)) continue;
                list.JumpItems.Add(new JumpTask
                {
                    Title = Path.GetFileName(p),
                    Description = p,
                    Arguments = $"\"{p}\"",
                    ApplicationPath = exe,
                    WorkingDirectory = Path.GetDirectoryName(exe),
                });
            }
            if (list.JumpItems.Count == 0) return;
            JumpList.SetJumpList(Application.Current, list);
            list.Apply();
        }
        catch (Exception ex) { AppendLog("warn", "更新跳转列表失败", ex.Message); }
    }

    /// <summary>当前是否已把 .md 注册到本程序（看 HKCU 里的 ProgId 指向）。</summary>
    private bool IsAssociated()
    {
        try
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(ProgKey + @"\shell\open\command");
            return k?.GetValue(null) is string cmd && cmd.Contains("MdReader", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>
    /// 注册 / 注销 .md 关联。只写 HKCU，不需要管理员权限，卸载时删干净即可。
    /// 注意：Windows 不允许程序自己抢占默认打开方式（UserChoice 有哈希保护），
    /// 所以这里做的是「让本程序出现在『打开方式』里」，用户选一次「始终」才成为默认。
    /// </summary>
    private void SetAssociation(bool on)
    {
        try
        {
            var exe = Environment.ProcessPath ?? "";
            if (on)
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(ExtKey))
                    k.SetValue(null, ProgId);
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(ProgKey))
                    k.SetValue(null, "Markdown 文档");
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(ProgKey + @"\DefaultIcon"))
                    k.SetValue(null, $"\"{exe}\",0");
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(ProgKey + @"\shell\open\command"))
                    k.SetValue(null, $"\"{exe}\" \"%1\"");
                AppendLog("info", "已注册 .md 关联 —— 在「打开方式」里可以选本程序了");
            }
            else
            {
                Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(ProgKey, false);
                using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(ExtKey, true);
                if (k?.GetValue(null) as string == ProgId) k.DeleteValue(null, false);
                AppendLog("info", "已注销 .md 关联");
            }
        }
        catch (Exception ex)
        {
            AppendLog("warn", "修改文件关联失败", ex.Message);
        }
    }

    /// <summary>标题栏右键菜单里的「最近打开」。</summary>
    private void BuildRecentMenu()
    {
        try
        {
            MenuRecent.Items.Clear();
            var any = false;
            foreach (var p in _recent)
            {
                if (!File.Exists(p)) continue;
                var mi = new MenuItem { Header = Path.GetFileName(p), ToolTip = p, Tag = p };
                mi.Click += async (s2, _) =>
                {
                    if (s2 is MenuItem m && m.Tag is string f) await InjectOpenFileAsync(f);
                };
                MenuRecent.Items.Add(mi);
                any = true;
            }
            if (!any) MenuRecent.Items.Add(new MenuItem { Header = "（暂无）", IsEnabled = false });
            MenuRecent.IsEnabled = any;
        }
        catch (Exception ex) { AppendLog("warn", "构建最近打开菜单失败", ex.Message); }
    }

    // ==================== 可视边带 0，但缩放热区仍在 ====================
    // WebView2 是子 HWND，会吞掉 WM_NCHITTEST。之前靠给 WebView2 留边距
    // （ResizeBandDip）把边缘让给 WPF —— 但那样会露出一圈窗口底色。
    // 这里改成：WebView2 铺满窗口（边距 0），给它装一层窗口过程子类，
    // 在窗口边缘若干像素内直接返回缩放码，交给系统去缩放。

    private const int WM_NCHITTEST = 0x0084;
    private const int GWLP_WNDPROC = -4;
    private const int HitBand = 6; // 判定宽度（与可视无关）

    [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, int msg,
        IntPtr wParam, IntPtr lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWnd, EnumProc lpEnumFunc, IntPtr lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    private delegate IntPtr WndProcDelegate(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private WndProcDelegate? _childProc;   // 必须保住引用，否则被 GC 回收后崩

    /// <summary>已装钩子的子窗口 → 它原来的窗口过程。</summary>
    /// <remarks>
    /// ⚠️ 两个要点：
    /// 1. **不能重复装**：对已装的窗口再 SetWindowLongPtr，会把「旧过程」记成自己的过程，
    ///    CallWindowProc 于是调回自己 → 无限递归。所以要记下装过哪些。
    /// 2. **要按窗口查旧过程**：多个子窗口各有一条链，不能共用一个 _oldProc。
    /// </remarks>
    private readonly Dictionary<IntPtr, IntPtr> _hookedChildren = new();

    private void HookWebViewChild()
    {
        try
        {
            var self = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            _childProc ??= ChildProc; // 保住引用
            var ptr = System.Runtime.InteropServices.Marshal.GetFunctionPointerForDelegate(_childProc);
            var added = 0;
            // ⚠️ 不按类名过滤，**所有后代窗口都要装**：Chromium 里光标下那个
            //    往往是内层的 Chrome_RenderWidgetHostHWND，只装 Chrome_WidgetWin*
            //    的话它返回 HTCLIENT，缩放照样失效（踩过）。
            //    EnumChildWindows 本身是递归的，遍历时全装即可。
            EnumChildWindows(self, (h, _) =>
            {
                try
                {
                    if (_hookedChildren.ContainsKey(h)) return true; // 装过别再装（会自递归）
                    var old = SetWindowLongPtr(h, GWLP_WNDPROC, ptr);
                    if (old != IntPtr.Zero) { _hookedChildren[h] = old; added++; }
                }
                catch { /* 个别窗口装不上不影响其它 */ }
                return true;
            }, IntPtr.Zero);
            if (added > 0)
                AppendLog("info",
                    $"新装 {added} 个缩放热区钩子（累计 {_hookedChildren.Count} 个，判定 {HitBand}px）");
            else if (_hookedChildren.Count == 0)
                AppendLog("warn", "未找到 WebView2 子窗口，缩放热区退回默认");
        }
        catch (Exception ex) { AppendLog("warn", "安装缩放热区钩子失败", ex.Message); }
    }

    private IntPtr ChildProc(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_NCHITTEST && WindowState == WindowState.Normal)
        {
            var v = lParam.ToInt64();
            var x = (int)(short)(v & 0xFFFF);
            var y = (int)(short)((v >> 16) & 0xFFFF);
            if (GetWindowRect(new System.Windows.Interop.WindowInteropHelper(this).Handle, out var r))
            {
                var left = x < r.Left + HitBand;
                var right = x >= r.Right - HitBand;
                var top = y < r.Top + HitBand;
                var bottom = y >= r.Bottom - HitBand;
                // ⚠️ 在**子窗口**里返回 HTLEFT 之类是没用的 —— 子窗口管不了父窗口缩放。
                // 正确做法是返回 HTTRANSPARENT(-1)，让系统把这次命中继续交给父窗口，
                // 由父窗口的 WindowChrome(ResizeBorderThickness) 去完成缩放。
                if (left || right || top || bottom) return (IntPtr)(-1); // HTTRANSPARENT
            }
        }
        var prev = _hookedChildren.TryGetValue(hWnd, out var p) ? p : IntPtr.Zero;
        return prev == IntPtr.Zero ? IntPtr.Zero : CallWindowProc(prev, hWnd, msg, wParam, lParam);
    }

    // ==================== 关闭确认 / 会话恢复 / 原生弹窗 ====================
    // 全部用 Wpf.Ui 的成熟控件（MessageBox），不自绘。

    private bool _allowClose;

    /// <summary>
    /// 恢复会话完成前，忽略网页的 session 上报。
    /// ⚠️ 网页一加载就会报一次（那时只有内置示例、文件列表是空的），
    ///    不挡住的话会把上次存的 session.json 直接清空 —— 恢复永远失效（踩过）。
    /// </summary>
    private bool _sessionReady;

    /// <summary>网页最近一次上报的会话状态（宿主缓存，关闭时直接用）。</summary>
    private readonly List<string> _lastFiles = new();
    private readonly List<string> _lastDirty = new();
    private string SessionStore => Path.Combine(DataRoot(), "session.json");

    /// <summary>问网页当前打开了哪些文档、哪些没保存。</summary>
    private async Task<(List<string> dirty, List<string> files)> QuerySessionAsync()
    {
        var dirty = new List<string>();
        var files = new List<string>();
        try
        {
            var core = Web.CoreWebView2;
            if (core is null) return (dirty, files);
            var raw = await core.ExecuteScriptAsync(
                "JSON.stringify(window.__sessionInfo ? window.__sessionInfo() : {dirty:[],files:[]})");
            // ExecuteScriptAsync 返回的是 JSON 字面量；字符串结果外面还包一层引号
            var json = JsonSerializer.Deserialize<string>(raw);
            if (string.IsNullOrEmpty(json)) return (dirty, files);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("dirty", out var d))
                foreach (var e in d.EnumerateArray()) { var v = e.GetString(); if (v != null) dirty.Add(v); }
            if (doc.RootElement.TryGetProperty("files", out var f))
                foreach (var e in f.EnumerateArray()) { var v = e.GetString(); if (v != null) files.Add(v); }
        }
        catch (Exception ex) { AppendLog("warn", "读取会话状态失败", ex.Message); }
        return (dirty, files);
    }

    private void SaveSession(IEnumerable<string> files)
    {
        try
        {
            var list = files.Where(File.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            File.WriteAllText(SessionStore, JsonSerializer.Serialize(list));
            AppendLog("info", $"已记录会话：{list.Count} 个文件");
        }
        catch (Exception ex) { AppendLog("warn", "保存会话失败", ex.Message); }
    }

    private List<string> LoadSession()
    {
        try
        {
            if (!File.Exists(SessionStore)) return new List<string>();
            return (JsonSerializer.Deserialize<List<string>>(File.ReadAllText(SessionStore)) ?? new())
                .Where(File.Exists).ToList();
        }
        catch { return new List<string>(); }
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (_allowClose) { base.OnClosing(e); return; }
        // 先拦下来，问完再关。
        // ⚠️ 不能在 Closing 事件里直接干重活：弹窗会挂在「正在关闭」的窗口上，
        //    一旦不返回就是「点关闭没反应」（踩过）。延到下一个 dispatcher 回合再做。
        e.Cancel = true;
        AppendLog("info", "收到关闭请求，先确认未保存的改动");
        Dispatcher.BeginInvoke(new Action(() => { _ = CloseFlowAsync(); }),
            System.Windows.Threading.DispatcherPriority.Normal);
    }

    private async Task CloseFlowAsync()
    {
        try
        {
            // ⚠️ 不再用 ExecuteScriptAsync 现问网页 —— 那个调用一旦失败会**静默返回空**，
            //    结果既弹不出「未保存」确认、又把空列表写进 session.json（踩过）。
            //    改成用网页主动上报、宿主缓存的 _lastDirty / _lastFiles。
            var dirty = new List<string>(_lastDirty);
            var files = new List<string>(_lastFiles);
            AppendLog("info",
                $"关闭流程：未保存 {dirty.Count} 个，已落盘 {files.Count} 个，会话就绪={_sessionReady}");
            if (dirty.Count > 0)
            {
                var list = new System.Windows.Controls.StackPanel { Margin = new Thickness(0, 2, 0, 2) };
                foreach (var name in dirty)
                {
                    list.Children.Add(new System.Windows.Controls.TextBlock
                    {
                        Text = name,
                        Margin = new Thickness(0, 3, 0, 3),
                        TextTrimming = TextTrimming.CharacterEllipsis,
                        ToolTip = name,
                        Foreground = (Brush)FindResource("TextFillColorPrimaryBrush"),
                    });
                }
                // 细滚动条：条目多时不至于撑破弹窗
                var scroll = new System.Windows.Controls.ScrollViewer
                {
                    MaxHeight = 240,
                    VerticalScrollBarVisibility = System.Windows.Controls.ScrollBarVisibility.Auto,
                    HorizontalScrollBarVisibility = System.Windows.Controls.ScrollBarVisibility.Disabled,
                    Content = list,
                };
                // ⚠️ 细滚动条**只设宽度、不换 ControlTemplate** ——
                //    之前自建模板在构造时抛异常（"初始化 ScrollBar 时引发了异常"），
                //    把整个弹窗构造炸掉 → 弹窗根本不出现（日志里抓到的）。
                var sbStyle = new Style(typeof(System.Windows.Controls.Primitives.ScrollBar));
                sbStyle.Setters.Add(new Setter(FrameworkElement.WidthProperty, 6.0));
                sbStyle.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, 6.0));
                scroll.Resources.Add(typeof(System.Windows.Controls.Primitives.ScrollBar), sbStyle);

                var panel = new System.Windows.Controls.StackPanel();
                panel.Children.Add(new System.Windows.Controls.TextBlock
                {
                    Text = "以下文本有未保存改动",
                    FontWeight = FontWeights.SemiBold,
                    Margin = new Thickness(0, 0, 0, 10),
                });
                panel.Children.Add(new Border
                {
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(14, 10, 8, 10),
                    Background = (Brush)FindResource("ControlFillColorDefaultBrush"),
                    BorderThickness = new Thickness(1),
                    BorderBrush = (Brush)FindResource("ControlStrokeColorDefaultBrush"),
                    Child = scroll,
                });

                var box = new Wpf.Ui.Controls.MessageBox
                {
                    Title = "有未保存的改动",
                    Content = panel,
                    PrimaryButtonText = "保存并关闭",
                    SecondaryButtonText = "不保存",
                    CloseButtonText = "取消",
                    // ⚠️ 不要设 Owner：窗口此刻正处在「关闭被拦下」的状态，
                    //    挂上去可能永远不返回 → 点关闭没反应（踩过）。
                };
                AppendLog("info", "弹出未保存确认");
                var r = await box.ShowDialogAsync();
                AppendLog("info", $"未保存确认结果：{r}");
                if (r == Wpf.Ui.Controls.MessageBoxResult.Primary)
                {
                    RunInPage("window.__saveAll && window.__saveAll()");
                    await Task.Delay(700); // 给网页一点时间写盘
                }
                else if (r == Wpf.Ui.Controls.MessageBoxResult.None) return; // 取消
            }
            SaveSession(files);
        }
        catch (Exception ex)
        {
            AppendLog("warn", "关闭流程出错", ex.Message);
            // 弹窗炸了也不能把会话丢了
            try { SaveSession(_lastFiles); } catch { /* 尽力而为 */ }
        }
        _allowClose = true;
        // 再延一个回合去关，别在事件处理链里重入
        Dispatcher.BeginInvoke(new Action(() => Close()),
            System.Windows.Threading.DispatcherPriority.Normal);
    }

    /// <summary>点标题栏上的菜单按钮，弹出同一个原生菜单。</summary>
    private void OnMenuButtonClick(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement fe || fe.ContextMenu is not ContextMenu cm) return;
        cm.PlacementTarget = fe;
        cm.Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom;
        cm.IsOpen = true;
    }

    private async void OnMenuOpen(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Filter = "Markdown|*.md;*.markdown|文本文件|*.txt|所有文件|*.*",
            Multiselect = true,
            RestoreDirectory = true,
        };
        if (dlg.ShowDialog(this) == true)
            foreach (var f in dlg.FileNames) await InjectOpenFileAsync(f);
    }

    private void OnMenuAssoc(object sender, RoutedEventArgs e)
    {
        SetAssociation(MenuAssoc.IsChecked);
        MenuAssoc.IsChecked = IsAssociated();
    }

    /// <summary>关于面板的版面（不用一串纯文本）。</summary>
    private System.Windows.Controls.StackPanel BuildAboutPanel(string ver)
    {
        var head = new System.Windows.Controls.StackPanel { Orientation = Orientation.Horizontal };
        head.Children.Add(new Wpf.Ui.Controls.SymbolIcon
        {
            Symbol = Wpf.Ui.Controls.SymbolRegular.DocumentText24,
            FontSize = 34,
            Margin = new Thickness(0, 0, 14, 0),
            VerticalAlignment = VerticalAlignment.Center,
        });
        var titleBox = new System.Windows.Controls.StackPanel();
        titleBox.Children.Add(new System.Windows.Controls.TextBlock
        {
            Text = "Markdown 阅读器",
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
        });
        titleBox.Children.Add(new System.Windows.Controls.TextBlock
        {
            Text = $"版本 {ver}",
            Opacity = 0.7,
            Margin = new Thickness(0, 2, 0, 0),
        });
        head.Children.Add(titleBox);

        var rows = new System.Windows.Controls.StackPanel();
        void Row(string k, string v)
        {
            var g = new System.Windows.Controls.Grid { Margin = new Thickness(0, 3, 0, 3) };
            g.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = new GridLength(84) });
            g.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var kt = new System.Windows.Controls.TextBlock { Text = k, Opacity = 0.65 };
            var vt = new System.Windows.Controls.TextBlock
            {
                Text = v,
                TextWrapping = TextWrapping.Wrap,
                FontFamily = new FontFamily("Consolas, Microsoft YaHei UI"),
            };
            System.Windows.Controls.Grid.SetColumn(kt, 0);
            System.Windows.Controls.Grid.SetColumn(vt, 1);
            g.Children.Add(kt);
            g.Children.Add(vt);
            rows.Children.Add(g);
        }
        Row("程序位置", Environment.ProcessPath ?? "—");
        Row("数据目录", DataRoot());
        Row("运行时", $".NET {Environment.Version} · WebView2 渲染");

        var panel = new System.Windows.Controls.StackPanel();
        panel.Children.Add(head);
        panel.Children.Add(new Border
        {
            Margin = new Thickness(0, 14, 0, 0),
            Padding = new Thickness(12, 10, 12, 10),
            CornerRadius = new CornerRadius(6),
            Background = (Brush)FindResource("ControlFillColorDefaultBrush"),
            Child = rows,
        });
        return panel;
    }

    private async void OnMenuAbout(object sender, RoutedEventArgs e)
    {
        var ver = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        var box = new Wpf.Ui.Controls.MessageBox
        {
            Title = "关于",
            Content = BuildAboutPanel(ver?.ToString() ?? "—"),
            PrimaryButtonText = "好",
            CloseButtonText = "关闭",
            Owner = this,
        };
        await box.ShowDialogAsync();
    }

    /// <summary>用网页发来的文档列表重建标题栏标签。</summary>
    private void SetDocs(JsonElement list)
    {
        try
        {
            _tabs.Clear();
            foreach (var el in list.EnumerateArray())
            {
                _tabs.Add(new DocTabItem
                {
                    Id = el.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "",
                    Label = el.TryGetProperty("label", out var l) ? l.GetString() ?? "" : "",
                    IsActive = el.TryGetProperty("active", out var a) && a.ValueKind == JsonValueKind.True,
                });
            }
        }
        catch (Exception ex)
        {
            AppendLog("warn", "更新标题栏标签失败", ex.Message);
        }
    }

    // ---- 标题栏交互 ----

    /// <summary>标题栏空白处按住可拖动窗口；双击切换最大化。</summary>
    private void OnTitleBarDrag(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2) { ToggleMaximize(); return; }
        if (e.LeftButton == MouseButtonState.Pressed) DragMove();
    }

    private void ToggleMaximize() =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    // ⚠️ ui:TitleBarButton 只有放进 ui:TitleBar 里才会自动接线到窗口动作；
    // 我们这里是自定义标题栏，独立使用**必须自己挂事件**，否则按钮点了没反应。
    private void OnMinClick(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void OnMaxClick(object sender, RoutedEventArgs e) => ToggleMaximize();

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void OnTabClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is not FrameworkElement fe || fe.Tag is not string id) return;
        e.Handled = true; // 别让这次点击冒泡成窗口拖动
        RunInPage($"window.__switchDoc && window.__switchDoc('{id}')");
    }

    private void OnTabCloseClick(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement fe || fe.Tag is not string id) return;
        e.Handled = true;
        RunInPage($"window.__closeDoc && window.__closeDoc('{id}')");
    }

    private void RunInPage(string js)
    {
        try { _ = Web.CoreWebView2?.ExecuteScriptAsync(js); }
        catch (Exception ex) { AppendLog("warn", "标题栏交互失败", ex.Message); }
    }

    /// <summary>把结果回传给网页上的某个回调（默认是 window.__saveResult）。</summary>
    private static async Task Reply(CoreWebView2 core, string json, string callback = "__saveResult")
    {
        try { await core.ExecuteScriptAsync($"window.{callback} && window.{callback}({json})"); }
        catch (Exception ex) { AppendLog("error", $"回传 {callback} 失败", ex.Message); }
    }

    /// <summary>把内嵌的 reader.html 释放到磁盘（虚拟域名映射需要真实文件夹）。</summary>
    /// <summary>页面内容没变就不重复写盘 —— 启动时少一次 4.6MB 写入。</summary>
    private string ExtractReaderIfChanged()
    {
        var target = Path.Combine(DataRoot(), "wwwroot", "reader.html");
        try
        {
            using var stream = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("MdReader.Assets.reader.html");
            if (stream is null) return ExtractReader();
            if (File.Exists(target))
            {
                var fi = new FileInfo(target);
                if (fi.Length == stream.Length) return target; // 大小一致就当没变
            }
        }
        catch { /* 走下面的完整抽取 */ }
        return ExtractReader();
    }

    private string ExtractReader()
    {
        var dest = Path.Combine(WwwRoot(), "reader.html");
        using var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream("MdReader.Assets.reader.html")
            ?? throw new InvalidOperationException("embedded reader.html not found");
        using var fs = File.Create(dest);
        stream.CopyTo(fs);
        return dest;
    }

    private async Task InitAsync()
    {
        ApplyWindowChrome();

        var env = await CoreWebView2Environment.CreateAsync(
            userDataFolder: Path.Combine(DataRoot(), "WebView2"));

        await Web.EnsureCoreWebView2Async(env);
        var core = Web.CoreWebView2;

        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreHostObjectsAllowed = true;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = true;

        // 原生文件读写桥：Ctrl+S 直接落盘
        core.AddHostObjectToScript("host", new HostBridge(this));

        // 内嵌页面经虚拟域名加载；外部 http(s) 链接交给系统浏览器
        var readerPath = ExtractReaderIfChanged();
        core.SetVirtualHostNameToFolderMapping(
            VirtualHost, Path.GetDirectoryName(readerPath)!,
            CoreWebView2HostResourceAccessKind.Allow);

        core.NavigationStarting += (_, args) =>
        {
            var url = args.Uri ?? "";
            if (url.StartsWith($"https://{VirtualHost}", StringComparison.OrdinalIgnoreCase)) return;
            if (url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
                OpenExternally(url);
                return;
            }
            if (url == "about:blank") return;
            args.Cancel = true; // file: 等其余协议一律拒绝
        };

        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (!string.IsNullOrEmpty(args.Uri)) OpenExternally(args.Uri);
        };

        // 网页 → 宿主：日志落盘 + 文件保存。
        // 保存**走消息通道**而不是宿主对象方法调用：宿主对象要走 COM IDispatch 编组，
        // 而「弹系统保存对话框」是阻塞式的，在那条路上不稳；消息通道是 WebView2
        // 官方推荐的双向通信方式，事件本身就在 UI 线程上，弹窗是安全的。
        core.WebMessageReceived += async (_, args) =>
        {
            JsonDocument? outer = null, inner = null;
            try
            {
                // ⚠️ 网页侧 postMessage 传字符串时，WebMessageAsJson 会是「JSON 字符串」
                //    （形如 "{\"type\":\"log\"}"），直接 TryGetProperty 会抛
                //    InvalidOperationException: requires an element of type 'Object'。
                //    这里统一解一层，字符串/对象两种写法都能吃。
                outer = JsonDocument.Parse(args.WebMessageAsJson);
                var root = outer.RootElement;
                if (root.ValueKind == JsonValueKind.String)
                {
                    inner = JsonDocument.Parse(root.GetString() ?? "null");
                    root = inner.RootElement;
                }
                if (root.ValueKind != JsonValueKind.Object)
                {
                    AppendLog("warn", $"收到非对象消息（{root.ValueKind}），已忽略");
                    return;
                }

                var type = root.TryGetProperty("type", out var tp) ? tp.GetString() : null;

                if (type == "log")
                {
                    var level = root.TryGetProperty("level", out var lv) ? lv.GetString() : "info";
                    var t = root.TryGetProperty("t", out var tt) ? tt.GetString() : "";
                    var msg = root.TryGetProperty("msg", out var mm) ? mm.GetString() : "";
                    var extra = root.TryGetProperty("extra", out var xx) && xx.ValueKind != JsonValueKind.Null
                        ? xx.ToString()
                        : null;
                    AppendLog(level ?? "info", $"{t} {msg}", extra);
                    return;
                }

                // 网页把当前主题与配色发过来，用于同步原生标题栏 ——
                // 标题栏默认跟随「系统」主题，而应用有自己的明暗开关，
                // 不同步的话会出现「应用切到暗色、标题栏还是亮的」。
                if (type == "theme")
                {
                    ApplyChromeTheme(
                        root.TryGetProperty("mode", out var mo) ? mo.GetString() : null,
                        root.TryGetProperty("bg", out var bg) ? bg.GetString() : null,
                        root.TryGetProperty("fg", out var fg) ? fg.GetString() : null,
                        root.TryGetProperty("bd", out var bd) ? bd.GetString() : null,
                        root.TryGetProperty("ac", out var ac) ? ac.GetString() : null,
                        root.TryGetProperty("win", out var win) ? win.GetString() : null);
                    return;
                }

                // 网页每次文档列表变化就报一次 → 随时落盘，不依赖关闭流程
                if (type == "session")
                {
                    if (!_sessionReady) return; // 见 _sessionReady 的说明
                    _lastFiles.Clear();
                    _lastDirty.Clear();
                    if (root.TryGetProperty("files", out var sf) && sf.ValueKind == JsonValueKind.Array)
                        foreach (var e in sf.EnumerateArray())
                        {
                            var v = e.GetString();
                            if (!string.IsNullOrEmpty(v)) _lastFiles.Add(v);
                        }
                    if (root.TryGetProperty("dirty", out var sd) && sd.ValueKind == JsonValueKind.Array)
                        foreach (var e in sd.EnumerateArray())
                        {
                            var v = e.GetString();
                            if (!string.IsNullOrEmpty(v)) _lastDirty.Add(v);
                        }
                    SaveSession(_lastFiles);
                    return;
                }

                // 拖入的文件：从消息里的 File 对象取磁盘路径回填给网页
                if (type == "dropFile")
                {
                    var docId = root.TryGetProperty("docId", out var de) ? de.GetString() : null;
                    string? dropped = null;
                    try
                    {
                        foreach (var o in args.AdditionalObjects)
                            if (o is Microsoft.Web.WebView2.Core.CoreWebView2File cf) { dropped = cf.Path; break; }
                    }
                    catch (Exception ex) { AppendLog("warn", "读取拖入文件路径失败", ex.Message); }
                    AppendLog("info",
                        $"拖入文件：{dropped ?? "(宿主未拿到路径)"}｜AdditionalObjects={args.AdditionalObjects.Count}");
                    if (!string.IsNullOrEmpty(dropped) && File.Exists(dropped))
                    {
                        RememberRecent(dropped);
                        await Reply(core,
                            JsonSerializer.Serialize(new { id = docId, path = dropped }), "__dropPath");
                    }
                    return;
                }

                // 当前文档名 → 原生标题栏（窗口标题也跟着变）
                if (type == "title")
                {
                    var tn = root.TryGetProperty("name", out var tne) ? tne.GetString() : null;
                    var tdirty = root.TryGetProperty("dirty", out var tde) && tde.ValueKind == JsonValueKind.True;
                    // 标题栏上的标签由 docs 消息负责，这里只同步窗口标题（任务栏显示用）
                    Title = (string.IsNullOrEmpty(tn) ? "Markdown 阅读器" : tn) + (tdirty ? " •" : "");
                    return;
                }

                // 文档列表 → 标题栏上的标签
                if (type == "docs")
                {
                    if (root.TryGetProperty("list", out var list)) SetDocs(list);
                    return;
                }

                // 网页请求「打开文件」：走原生对话框，这样才知道真实磁盘路径
                // （网页的 <input type=file> / 拖放拿到的 File 对象没有路径）
                if (type == "openDialog")
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog
                    {
                        Filter = "Markdown|*.md;*.markdown|文本文件|*.txt|所有文件|*.*",
                        Multiselect = true,
                        RestoreDirectory = true,
                    };
                    if (dlg.ShowDialog(this) == true)
                        foreach (var f in dlg.FileNames) await InjectOpenFileAsync(f);
                    return;
                }

                // 文档属性：读磁盘上的文件信息
                if (type == "stat")
                {
                    var sp = root.TryGetProperty("path", out var spe) ? spe.GetString() : null;
                    if (string.IsNullOrEmpty(sp) || !File.Exists(sp))
                    {
                        await Reply(core, "{\"exists\":false}", "__statResult");
                    }
                    else
                    {
                        var fi = new FileInfo(sp);
                        await Reply(core, JsonSerializer.Serialize(new
                        {
                            exists = true,
                            size = fi.Length,
                            mtime = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                        }), "__statResult");
                    }
                    return;
                }

                // 在资源管理器中定位该文件
                if (type == "reveal")
                {
                    var rp = root.TryGetProperty("path", out var rpe) ? rpe.GetString() : null;
                    if (string.IsNullOrEmpty(rp) || !File.Exists(rp))
                    {
                        await Reply(core,
                            "{\"ok\":false,\"error\":\"文件还不在磁盘上（先保存一次）\"}", "__revealResult");
                        return;
                    }
                    try
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = "explorer.exe",
                            Arguments = $"/select,\"{rp}\"",
                            UseShellExecute = true
                        });
                        AppendLog("info", $"已在资源管理器中定位 {rp}");
                        await Reply(core, "{\"ok\":true}", "__revealResult");
                    }
                    catch (Exception ex)
                    {
                        AppendLog("warn", "打开资源管理器失败", ex.Message);
                        await Reply(core, JsonSerializer.Serialize(new { ok = false, error = ex.Message }),
                            "__revealResult");
                    }
                    return;
                }

                if (type != "save") return;

                var content = root.GetProperty("content").GetString() ?? "";
                var path = root.TryGetProperty("path", out var pp) ? pp.GetString() : null;

                if (string.IsNullOrEmpty(path))
                {
                    var suggested = root.TryGetProperty("name", out var nn) ? nn.GetString() : null;
                    var dlg = new Microsoft.Win32.SaveFileDialog
                    {
                        FileName = suggested ?? "untitled.md",
                        Filter = "Markdown|*.md;*.markdown|文本文件|*.txt|所有文件|*.*",
                        RestoreDirectory = true
                    };
                    if (dlg.ShowDialog(this) != true)
                    {
                        await Reply(core, "{\"canceled\":true}");
                        return;
                    }
                    path = dlg.FileName;
                }

                if (string.IsNullOrEmpty(path))
                {
                    await Reply(core, "{\"ok\":false,\"error\":\"未选择保存路径\"}");
                    return;
                }

                var ext = Path.GetExtension(path).ToLowerInvariant();
                if (ext is not (".md" or ".markdown" or ".txt"))
                {
                    await Reply(core, "{\"ok\":false,\"error\":\"只支持 .md / .markdown / .txt\"}");
                    return;
                }

                File.WriteAllText(path, content, new UTF8Encoding(false));
                AppendLog("info", $"已保存 {path}");
                await Reply(core, JsonSerializer.Serialize(new { ok = true, path }));
            }
            catch (Exception ex)
            {
                AppendLog("error", "处理网页消息失败", ex.ToString());
                try { await Reply(core, JsonSerializer.Serialize(new { ok = false, error = ex.Message })); }
                catch { /* 忽略：回传失败也不能崩 */ }
            }
            finally
            {
                inner?.Dispose();
                outer?.Dispose();
            }
        };

        // 告诉网页「本宿主支持消息通道版保存」，网页据此选择走哪条路
        core.NavigationCompleted += async (_, __) =>
        {
            try
            {
                await core.ExecuteScriptAsync("window.__hostVersion = 2");
                AppendLog("info", "已向网页声明 __hostVersion = 2（消息通道版保存可用）");
            }
            catch (Exception ex)
            {
                AppendLog("warn", "写入 __hostVersion 失败", ex.Message);
            }
        };

        AppendLog("info", $"MdReader 启动；数据目录 = {DataRoot()}；原生标题栏高 {TitleCtl.ActualHeight:0.#} dip");

        // 主题跟随 Windows，实时同步给网页
        ApplicationThemeManager.Changed += (theme, __accent) =>
        {
            var jsTheme = theme == ApplicationTheme.Light ? "light" : "dark";
            _ = core.ExecuteScriptAsync($"window.__setTheme && window.__setTheme('{jsTheme}')");
        };
        ApplicationThemeManager.ApplySystemTheme();

        // 注意：这里**不要**再挂第二个 WebMessageReceived。
        // 原来还有一个处理 requestTheme 的订阅者，但网页侧早已改成主动推 theme，
        // 留着只会有两个订阅者同时解析同一条消息，纯属干扰，已删除。

        Web.Source = new Uri($"https://{VirtualHost}/reader.html");

        HookWebViewChild();

        // ⚠️ Chromium 在**导航、尺寸变化时会重建它的子窗口**，钩子随之丢失 ——
        //    这正是「装了钩子却还是拖不动」的原因。这两处都要补装。
        Web.SizeChanged += (_, _) => HookWebViewChild();
        core.NavigationCompleted += (_, _) => HookWebViewChild();

        LoadRecent();
        BuildRecentMenu();
        ApplyJumpList();
        MenuAssoc.IsChecked = IsAssociated();

        // 命令行没给文件时，恢复上次关闭时打开的那些
        if (_pendingFiles.Count == 0) _pendingFiles.AddRange(LoadSession());

        foreach (var f in _pendingFiles)
            await InjectOpenFileAsync(f);
        _pendingFiles.Clear();

        // 恢复完了才允许网页覆盖会话文件
        await Task.Delay(300);
        _sessionReady = true;
    }

    private static void OpenExternally(string url)
    {
        try
        {
            System.Diagnostics.Process.Start(
                new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { /* 忽略无法打开的协议 */ }
    }

    internal async Task OpenFileAt(string path)
    {
        Activate();
        await InjectOpenFileAsync(path);
    }

    private async Task InjectOpenFileAsync(string path)
    {
        // 等 WebView2 初始化
        for (var i = 0; i < 60 && Web.CoreWebView2 is null; i++)
            await Task.Delay(100);

        var core = Web.CoreWebView2;
        if (core is null) return;

        // ⚠️ 只等 CoreWebView2 不够 —— 那时**页面还没加载完，window.__openFile 还不存在**，
        //    下面的 ExecuteScriptAsync 会被静默丢弃 → 会话恢复/命令行打开全部失效（踩过）。
        //    这里轮询到页面把桥接函数挂上为止。
        for (var i = 0; i < 100; i++)
        {
            var ready = await core.ExecuteScriptAsync("typeof window.__openFile === 'function'");
            if (ready == "true") break;
            await Task.Delay(100);
        }

        var b64 = Convert.ToBase64String(await File.ReadAllBytesAsync(path));
        var name = JsonSerializer.Serialize(Path.GetFileName(path));
        // 第三个参数是真实磁盘路径 —— 网页通过拖放/文件选择器拿到的 File 对象
        // 是不带路径的（浏览器安全限制），只有宿主这边知道，所以要传过去。
        var full = JsonSerializer.Serialize(path);
        await core.ExecuteScriptAsync(
            $"window.__openFile && window.__openFile({name}, \"{b64}\", {full})");
        RememberRecent(path);
    }
}

/// <summary>标题栏上一个文档标签的数据。</summary>
public class DocTabItem
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public bool IsActive { get; set; }
}

/// <summary>
/// 通过 AddHostObjectToScript 暴露给 JS：网页内 Ctrl+S 直接写磁盘。
///
/// ⚠️ 这两个特性是**必需的**，不能删。WebView2 的宿主对象是走 COM IDispatch 编组的；
/// 缺了它们 AddHostObjectToScript 也不报错，但 JS 拿到的代理上没有任何方法，
/// 调用时就变成 `await undefined(...)` → 抛错 → 未捕获的 Promise 拒绝 →
/// 表现就是「点了按钮毫无反应」，而且控制台之外看不出任何线索。
/// </summary>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class HostBridge
{
    private readonly MainWindow _owner;

    public HostBridge(MainWindow owner) => _owner = owner;

    /// <summary>把文本写入指定路径（UTF-8 无 BOM）。返回 "ok" 或 "error: 消息"。</summary>
    public string WriteTextFile(string path, string content)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path)) return "error: empty path";
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext is not (".md" or ".markdown" or ".txt")) return "error: only .md/.markdown/.txt";
            File.WriteAllText(path, content, new UTF8Encoding(false));
            return "ok";
        }
        catch (Exception ex) { return "error: " + ex.Message; }
    }

    /// <summary>弹出系统保存对话框，返回选中的路径或空串。</summary>
    public string PickSavePath(string suggestedName)
    {
        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            FileName = suggestedName,
            Filter = "Markdown|*.md;*.markdown|文本文件|*.txt|所有文件|*.*",
            // 便携应用不要把进程当前目录留在用户上次选的位置
            RestoreDirectory = true
        };
        return dlg.ShowDialog(_owner) == true ? dlg.FileName : "";
    }
}
