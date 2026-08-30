import tempfile
import unittest
from pathlib import Path

from PIL import Image

from auto_converter import convert_folder, discover_groups


class AutoConverterTest(unittest.TestCase):
    def test_discovers_each_child_folder_as_a_pdf_group(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "漫畫"
            output = root / "輸出"
            chapter_one = source / "第一章"
            chapter_two = source / "第二章" / "內頁"
            chapter_one.mkdir(parents=True)
            chapter_two.mkdir(parents=True)
            output.mkdir()
            Image.new("RGB", (120, 80), "red").save(chapter_one / "1.png")
            Image.new("RGB", (80, 120), "blue").save(chapter_two / "1.jpg")

            scan = discover_groups({"sourceFolder": str(source), "outputFolder": str(output)})

            self.assertTrue(scan["success"], scan)
            self.assertEqual([group["name"] for group in scan["groups"]], ["第一章", "第二章"])
            self.assertEqual([group["imageCount"] for group in scan["groups"]], [1, 1])
            self.assertTrue(all(group["thumbnail"].startswith("data:image/jpeg;base64,") for group in scan["groups"]))

    def test_converts_nested_images_to_pdf(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "來源圖片"
            output = root / "輸出"
            nested = source / "子資料夾"
            nested.mkdir(parents=True)
            output.mkdir()
            Image.new("RGB", (120, 80), "red").save(source / "1.png")
            Image.new("RGB", (80, 120), "blue").save(nested / "2.jpg")

            result = convert_folder(
                {
                    "sourceFolder": str(source),
                    "outputFolder": str(output),
                    "pageSize": "image",
                    "marginSize": "24",
                    "namingMode": "system",
                    "moveOriginals": False,
                },
                "20260830001",
            )

            self.assertTrue(result["success"], result)
            self.assertEqual(result["pages"], 2)
            self.assertEqual(result["name"], "20260830001.pdf")
            pdf = (output / result["name"]).read_bytes()
            self.assertTrue(pdf.startswith(b"%PDF-1.4"))
            self.assertIn(b"/Count 2", pdf)


if __name__ == "__main__":
    unittest.main()
