import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// Avoid retaining decoded image data in sharp's libvips cache during bulk uploads.
sharp.cache(false);

@Injectable()
export class BucketService {
  private s3: S3Client;
  private bucketName: string;
  private publicDomain: string;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get('R2_SECRET_ACCESS_KEY');
    const accountId = this.configService.get('R2_ACCOUNT_ID');
    this.bucketName = this.configService.get('R2_BUCKET_NAME') || 'product-images';
    this.publicDomain = this.configService.get('R2_PUBLIC_DOMAIN') || 'https://product-images.macfarma.com.br';

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
      }
    });
  }

  public async deleteAllImages(): Promise<{ deletedCount: number; errors: string[] }> {
    try {
      console.log('🗑️ Starting deletion of all images from bucket...');

      let deletedCount = 0;
      const errors: string[] = [];
      let continuationToken: string | undefined;

      do {
        // List objects in the bucket
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucketName,
          ContinuationToken: continuationToken,
          MaxKeys: 1000 // Process in batches of 1000
        });

        const listResponse = await this.s3.send(listCommand);
        const objects = listResponse.Contents || [];

        if (objects.length === 0) {
          console.log('Bucket is already empty');
          break;
        }

        // Prepare objects for deletion
        const objectsToDelete = objects.map((obj) => ({ Key: obj.Key }));

        // Delete objects in batch
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: objectsToDelete,
            Quiet: false
          }
        });

        const deleteResponse = await this.s3.send(deleteCommand);

        // Count successful deletions
        const successfulDeletions = deleteResponse.Deleted?.length || 0;
        deletedCount += successfulDeletions;

        // Log any errors
        if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
          deleteResponse.Errors.forEach((error) => {
            const errorMsg = `Failed to delete ${error.Key}: ${error.Message}`;
            console.error(`${errorMsg}`);
            errors.push(errorMsg);
          });
        }

        console.log(`✅ Deleted ${successfulDeletions} objects in this batch`);

        // Continue with next batch if there are more objects
        continuationToken = listResponse.NextContinuationToken;
      } while (continuationToken);

      console.log(`🎉 Successfully deleted ${deletedCount} images from bucket`);
      if (errors.length > 0) {
        console.log(`⚠️ ${errors.length} errors occurred during deletion`);
      }

      return { deletedCount, errors };
    } catch (err) {
      console.error('Error deleting images from bucket:', err);
      throw err;
    }
  }

  public async deleteImage(imageKey: string): Promise<boolean> {
    try {
      console.log(`🗑️ Deleting image with key: ${imageKey}`);

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: [{ Key: imageKey }],
          Quiet: false
        }
      });

      const response = await this.s3.send(deleteCommand);

      if (response.Deleted && response.Deleted.length > 0) {
        console.log(`✅ Successfully deleted image: ${imageKey}`);
        return true;
      } else {
        console.log(`⚠️ Image not found or already deleted: ${imageKey}`);
        return false;
      }
    } catch (err) {
      console.error(`Error deleting image ${imageKey}:`, err);
      return false;
    }
  }

  /**
   * Memory-optimized image upload from URL with streaming
   */
  public async uploadImageFromUrl(imageUrl?: string, imageId?: string): Promise<string> {
    if (!imageUrl) return null;

    let imageBuffer: Buffer = null;
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024, // 5MB limit (reduced from 10MB)
        maxBodyLength: 5 * 1024 * 1024 // 5MB limit
      });

      imageBuffer = Buffer.from(response.data);
      const result = await this.uploadImage(imageBuffer, imageId);
      
      // Aggressively clear buffers from memory
      if (imageBuffer) imageBuffer.fill(0);
      response.data = null;
      imageBuffer = null;
      
      return result;
    } catch (error) {
      console.error(`Error downloading image from ${imageUrl}:`, error.message);
      // Clean up buffer even on error
      if (imageBuffer) {
        imageBuffer.fill(0);
        imageBuffer = null;
      }
      return null;
    }
  }

  /**
   * Memory-optimized image upload with immediate cleanup
   */
  public async uploadImage(fileContent: Buffer, imageId?: string): Promise<string> {
    let resizedImageBuffer: Buffer = null;
    try {
      resizedImageBuffer = await this.resizeImage(fileContent);

      // Create the command to upload the file
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: imageId, // The name of the file in the bucket
        Body: resizedImageBuffer,
        ContentType: 'image/jpeg' // IMPORTANT: Set the correct content type
      });

      // Execute the upload
      await this.s3.send(command);

      // --- 3. CONSTRUCT PUBLIC URL ---
      const publicUrl = `${this.publicDomain}/${imageId}`;

      // Clear buffers from memory AFTER upload
      if (resizedImageBuffer) resizedImageBuffer.fill(0);
      if (fileContent) fileContent.fill(0);
      resizedImageBuffer = null;

      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error.message);
      // Clean up buffers even on error
      if (resizedImageBuffer) {
        resizedImageBuffer.fill(0);
        resizedImageBuffer = null;
      }
      if (fileContent) fileContent.fill(0);
      throw error;
    }
  }

  /**
   * Memory-optimized image resizing with immediate cleanup
   */
  private async resizeImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      
      // If image is already small enough, return as is
      if (metadata.width <= 800 && metadata.height <= 800) {
        return imageBuffer;
      }

      // Use smaller dimensions and lower quality to reduce memory
      const resizedImageBuffer = await sharp(imageBuffer)
        .resize(800, 800, {
          position: 'center',
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
        })
        .jpeg({ quality: 80, progressive: true }) // Lower quality and progressive for memory
        .toBuffer();
      
      // Clear original buffer from memory ONLY if we created a new one
      if (resizedImageBuffer !== imageBuffer) {
        imageBuffer.fill(0);
      }
      
      return resizedImageBuffer;
    } catch (error) {
      console.error('Error resizing image:', error.message);
      // Return original buffer if resizing fails
      return imageBuffer;
    }
  }
}
