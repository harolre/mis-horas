import { useEffect, useState } from 'react';
import type { Attachment } from '../../types';
import { Icon } from '../../components/Icon';
import { binaryToBlob } from '../../db/binary';

export function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment.thumb) {
      setUrl(null);
      return;
    }
    const thumbBlob = binaryToBlob(attachment.thumb, 'image/jpeg');
    if (!thumbBlob) return;
    const objectUrl = URL.createObjectURL(thumbBlob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [attachment.thumb]);

  if (url) {
    return <img src={url} alt="" loading="lazy" />;
  }

  const extension = attachment.name.split('.').pop()?.slice(0, 4) ?? '';
  return (
    <div className="attach-file-icon">
      <Icon
        name={attachment.mime === 'application/pdf' ? 'file' : 'image'}
        size={26}
      />
      <span>{extension}</span>
    </div>
  );
}
