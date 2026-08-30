"""桌面版自動資料夾轉 PDF 引擎。"""

from __future__ import annotations

import base64
import io
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Callable

from PIL import Image, ImageOps


SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def sanitize_name(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).rstrip(". ")[:100]
    return cleaned or "圖片合併"


def unique_output_path(folder: Path, stem: str) -> Path:
    candidate = folder / f"{stem}.pdf"
    number = 2
    while candidate.exists():
        candidate = folder / f"{stem}-{number}.pdf"
        number += 1
    return candidate


def find_images(folder: Path, excluded_folder: Path | None = None, recursive: bool = True) -> list[Path]:
    iterator = folder.rglob("*") if recursive else folder.iterdir()
    images = [
        path for path in iterator
        if path.is_file()
        and path.suffix.lower() in SUPPORTED_SUFFIXES
        and (excluded_folder is None or not path.resolve().is_relative_to(excluded_folder))
    ]
    images.sort(key=lambda path: natural_key(path.relative_to(folder).as_posix()))
    return images


def thumbnail_data_url(image_path: Path) -> str:
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((160, 120))
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=78, optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
    except Exception:
        return ""


def make_group(folder: Path, image_paths: list[Path], root_images_only: bool = False) -> dict:
    return {
        "path": str(folder),
        "name": folder.name,
        "imageCount": len(image_paths),
        "thumbnail": thumbnail_data_url(image_paths[0]),
        "rootImagesOnly": root_images_only,
    }


def discover_groups(settings: dict) -> dict:
    source = Path(str(settings.get("sourceFolder", ""))).expanduser()
    output = Path(str(settings.get("outputFolder", ""))).expanduser()
    validation_error = validate_folders(source, output)
    if validation_error:
        return {"success": False, "error": validation_error}

    resolved_output = output.resolve()
    groups: list[dict] = []
    root_images = find_images(source, resolved_output, recursive=False)
    if root_images:
        groups.append(make_group(source, root_images, root_images_only=True))

    child_folders = [path for path in source.iterdir() if path.is_dir() and path.resolve() != resolved_output]
    child_folders.sort(key=lambda path: natural_key(path.name))
    for folder in child_folders:
        images = find_images(folder, resolved_output, recursive=True)
        if images:
            groups.append(make_group(folder, images))

    if not groups:
        return {"success": False, "error": "來源資料夾內找不到 JPG、PNG 或 WebP 圖片"}
    return {"success": True, "groups": groups, "totalImages": sum(group["imageCount"] for group in groups)}


def prepare_jpeg(image_path: Path) -> tuple[int, int, bytes]:
    with Image.open(image_path) as source:
        source.load()
        oriented = ImageOps.exif_transpose(source)
        if oriented.mode == "RGB":
            rgb = oriented.copy()
        else:
            rgba = oriented.convert("RGBA")
            rgb = Image.new("RGB", rgba.size, "white")
            rgb.paste(rgba, mask=rgba.getchannel("A"))

    output = io.BytesIO()
    rgb.save(output, format="JPEG", quality=92, optimize=True)
    return rgb.width, rgb.height, output.getvalue()


def page_layout(width: int, height: int, page_mode: str, margin: float) -> tuple[float, ...]:
    if page_mode == "a4":
        landscape = width > height
        page_width, page_height = ((841.89, 595.28) if landscape else (595.28, 841.89))
    else:
        page_width = width * 0.75 + margin * 2
        page_height = height * 0.75 + margin * 2

    available_width = max(1.0, page_width - margin * 2)
    available_height = max(1.0, page_height - margin * 2)
    scale = min(available_width / width, available_height / height)
    draw_width = width * scale
    draw_height = height * scale
    return (
        page_width,
        page_height,
        draw_width,
        draw_height,
        (page_width - draw_width) / 2,
        (page_height - draw_height) / 2,
    )


def pdf_number(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def write_pdf(
    image_paths: list[Path],
    destination: Path,
    page_mode: str,
    margin: float,
    progress: Callable[[int, int], None] | None = None,
) -> int:
    prepared: list[tuple[int, int, bytes]] = []
    total = len(image_paths)
    for index, image_path in enumerate(image_paths, 1):
        prepared.append(prepare_jpeg(image_path))
        if progress:
            progress(index, total)

    page_count = len(prepared)
    object_count = 2 + page_count * 3
    page_refs = " ".join(f"{3 + index * 3} 0 R" for index in range(page_count))
    offsets = [0] * (object_count + 1)

    with destination.open("wb") as pdf:
        pdf.write(b"%PDF-1.4\n%\xff\xff\xff\xff\n")

        def write_object(number: int, parts: list[bytes]) -> None:
            offsets[number] = pdf.tell()
            pdf.write(f"{number} 0 obj\n".encode("ascii"))
            for part in parts:
                pdf.write(part)
            pdf.write(b"\nendobj\n")

        write_object(1, [b"<< /Type /Catalog /Pages 2 0 R >>"])
        write_object(2, [f"<< /Type /Pages /Count {page_count} /Kids [{page_refs}] >>".encode("ascii")])

        for index, (width, height, jpeg) in enumerate(prepared):
            page_object = 3 + index * 3
            content_object = page_object + 1
            image_object = page_object + 2
            page_width, page_height, draw_width, draw_height, x, y = page_layout(width, height, page_mode, margin)
            content = (
                f"q\n{pdf_number(draw_width)} 0 0 {pdf_number(draw_height)} "
                f"{pdf_number(x)} {pdf_number(y)} cm\n/Im0 Do\nQ\n"
            ).encode("ascii")
            page_dictionary = (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pdf_number(page_width)} {pdf_number(page_height)}] "
                f"/Resources << /XObject << /Im0 {image_object} 0 R >> >> /Contents {content_object} 0 R >>"
            ).encode("ascii")
            write_object(page_object, [page_dictionary])
            write_object(content_object, [f"<< /Length {len(content)} >>\nstream\n".encode("ascii"), content, b"endstream"])
            image_dictionary = (
                f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n"
            ).encode("ascii")
            write_object(image_object, [image_dictionary, jpeg, b"\nendstream"])

        xref_offset = pdf.tell()
        pdf.write(f"xref\n0 {object_count + 1}\n0000000000 65535 f \n".encode("ascii"))
        for number in range(1, object_count + 1):
            pdf.write(f"{offsets[number]:010d} 00000 n \n".encode("ascii"))
        pdf.write(
            f"trailer\n<< /Size {object_count + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
        )
    return page_count


def move_originals(image_paths: list[Path], source: Path, output: Path, pdf_stem: str) -> None:
    archive_root = output / f"{pdf_stem}-原始圖片"
    for image_path in image_paths:
        relative = image_path.relative_to(source)
        destination = archive_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination = destination.with_name(f"{destination.stem}-{datetime.now():%H%M%S%f}{destination.suffix}")
        shutil.move(str(image_path), str(destination))


def validate_folders(source: Path, output: Path) -> str | None:
    if not source.is_dir():
        return "來源資料夾不存在或無法讀取"
    if not output.is_dir():
        return "目的資料夾不存在或無法寫入"
    if source.resolve() == output.resolve():
        return "來源與目的資料夾不能相同"
    return None


def convert_folder(settings: dict, system_name: str | None = None) -> dict:
    source = Path(str(settings.get("groupFolder") or settings.get("sourceFolder", ""))).expanduser()
    output = Path(str(settings.get("outputFolder", ""))).expanduser()
    validation_error = validate_folders(source, output)
    if validation_error:
        return {"success": False, "error": validation_error}

    resolved_output = output.resolve()
    image_paths = find_images(source, resolved_output, recursive=not bool(settings.get("rootImagesOnly")))
    if not image_paths:
        return {"success": False, "error": "來源資料夾內找不到 JPG、PNG 或 WebP 圖片"}

    stem = system_name if settings.get("namingMode") == "system" and system_name else sanitize_name(source.name)
    destination = unique_output_path(output, stem)
    try:
        pages = write_pdf(
            image_paths,
            destination,
            str(settings.get("pageSize", "image")),
            float(settings.get("marginSize", 24)),
        )
        if settings.get("moveOriginals"):
            move_originals(image_paths, source, output, destination.stem)
        return {
            "success": True,
            "path": str(destination),
            "name": destination.name,
            "pages": pages,
            "finishedAt": datetime.now().strftime("%Y/%m/%d %H:%M:%S"),
        }
    except Exception as error:
        if destination.exists():
            destination.unlink(missing_ok=True)
        return {"success": False, "error": f"轉換失敗：{error}"}
