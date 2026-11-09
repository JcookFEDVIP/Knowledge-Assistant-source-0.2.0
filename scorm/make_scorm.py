"""Wrap the built app folder in a launch-only SCORM 1.2 package for Docebo.

Usage (from anywhere):
    python3 make_scorm.py <app folder> <output zip> [version]

The app folder is read only. The zip gets the app's files plus imsmanifest.xml,
launch.html and scorm.js (from this folder). On launch the package tells the LMS
the course is completed; there is no other tracking.
"""
import os
import sys
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER_FILES = ["launch.html", "scorm.js"]
SKIP = {".DS_Store", "Thumbs.db", "desktop.ini"}

MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="KNOWLEDGE_ASSISTANT_{ident}" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>{title}</title>
      <item identifier="ITEM" identifierref="RES">
        <title>{title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="launch.html">
{files}
    </resource>
  </resources>
</manifest>
"""


def app_files(app_dir):
    out = []
    for root, dirs, files in os.walk(app_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if name in SKIP or name.startswith("."):
                continue
            full = os.path.join(root, name)
            out.append((full, os.path.relpath(full, app_dir).replace(os.sep, "/")))
    return sorted(out, key=lambda f: f[1])


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    app_dir, out_zip = sys.argv[1], sys.argv[2]
    version = sys.argv[3] if len(sys.argv) > 3 else "0.0.0"
    if not os.path.isfile(os.path.join(app_dir, "index.html")):
        sys.exit("No index.html in %s; is this the built app folder?" % app_dir)

    files = app_files(app_dir)
    names = [rel for _, rel in files]
    clash = [w for w in WRAPPER_FILES + ["imsmanifest.xml"] if w in names]
    if clash:
        sys.exit("App folder already contains %s" % ", ".join(clash))

    title = escape("ARIA - Agent Resource and Information Assistant %s (preview)" % version)
    listing = "\n".join(
        '      <file href="%s"/>' % escape(n) for n in WRAPPER_FILES + names
    )
    manifest = MANIFEST.format(
        ident=version.replace(".", "_"), title=title, files=listing
    )

    tmp = out_zip + ".part"
    with zipfile.ZipFile(tmp, "w") as z:
        z.writestr("imsmanifest.xml", manifest, zipfile.ZIP_DEFLATED)
        for w in WRAPPER_FILES:
            z.write(os.path.join(HERE, w), w, zipfile.ZIP_DEFLATED)
        for full, rel in files:
            # JPEGs don't compress; store them to keep packaging fast.
            method = zipfile.ZIP_STORED if rel.lower().endswith((".jpg", ".jpeg", ".png")) else zipfile.ZIP_DEFLATED
            z.write(full, rel, method)
    os.replace(tmp, out_zip)

    size_mb = os.path.getsize(out_zip) / (1024 * 1024)
    count = len(files) + len(WRAPPER_FILES) + 1
    print("wrote %s: %d files, %.0f MB" % (out_zip, count, size_mb))
    if size_mb > 1000 or count > 15000:
        print("WARNING: over Docebo's limits (1 GB, 15,000 files)")


if __name__ == "__main__":
    main()
