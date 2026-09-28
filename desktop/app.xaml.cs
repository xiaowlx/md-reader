using System.Windows;

namespace MdReader;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // 支持 "MdReader.exe a.md b.md …" 一次打开多个文档（各开一个标签）
        var paths = e.Args
            .Where(a => !string.IsNullOrWhiteSpace(a) && System.IO.File.Exists(a))
            .ToArray();

        var win = new MainWindow(paths);
        MainWindow = win;
        win.Show();
    }
}
